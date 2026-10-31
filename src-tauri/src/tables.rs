//! Editing a table without writing code: adding and removing rows and columns where the cursor is,
//! the header row, and a caption (which makes it a numbered figure). The table is read with Typst's
//! own parser and written back neatly, one row per line; its other settings are kept as written.
//! Its style (lines, shading, alignment, spacing, widths) is offered as simple choices, each
//! written as plain Typst; settings written another way are kept, as "custom".
//! Tables written in other ways (merged cells, lines…) are left to the code.
//! Positions are counted in UTF-16 code units, like the editor counts characters.

use crate::page_settings::{content, plain_text};
use crate::problems::check_note;
use serde::{Deserialize, Serialize};
use std::ops::Range;
use typst::syntax::ast::{self, AstNode};
use typst::syntax::Source;

const CODE_ONLY: &str = "This table can only be changed as code.";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TableInfo {
    pub columns: usize,
    /// Rows under the header.
    pub rows: usize,
    pub header: bool,
    pub caption: Option<String>,
    /// The cell the cursor is in (the row is None in the header).
    pub row: Option<usize>,
    pub column: Option<usize>,
}

/// One cell, as the table editor shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Cell {
    /// Its text: as typed if it's plain text (without escapes), as Typst markup otherwise.
    pub text: String,
    /// False for cells written as code (like `"a string"`), which are left as they are.
    pub editable: bool,
    /// Where it starts in the table (so changes can be made at it).
    pub start: usize,
}

/// A whole table, as the table editor shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TableCells {
    pub columns: usize,
    pub header: Option<Vec<Cell>>,
    pub rows: Vec<Vec<Cell>>,
    pub caption: Option<String>,
    pub style: TableStyle,
}

/// Which lines the table has.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Lines {
    /// Around every cell (Typst's default).
    All,
    /// Only between rows.
    Rows,
    /// A rule at the top, under the header and at the bottom, like in papers.
    Academic,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Align {
    Left,
    Center,
    Right,
}

/// The room inside each cell.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Spacing {
    Compact,
    Normal,
    Roomy,
}

/// How wide the columns are.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Widths {
    /// As wide as their content.
    Auto,
    /// Sharing the page's width equally.
    Equal,
}

/// A table's style. Each is None when it's written some other way (as code): "custom".
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStyle {
    pub lines: Option<Lines>,
    pub striped: Option<bool>,
    pub shaded_header: Option<bool>,
    /// Each column's alignment.
    pub align: Option<Vec<Align>>,
    pub spacing: Option<Spacing>,
    pub widths: Option<Widths>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "action", content = "value", rename_all = "camelCase")]
pub enum TableAction {
    /// Sets a cell's text (`row` None is the header). Text that would break the note is written
    /// as plain text instead.
    SetCell { row: Option<usize>, column: usize, text: String },
    AddRowBelow,
    AddColumnRight,
    DeleteRow,
    DeleteColumn,
    ToggleHeader,
    SetCaption(Option<String>),
    SetLines(Lines),
    SetStriped(bool),
    SetShadedHeader(bool),
    SetAlign { column: usize, align: Align },
    SetSpacing(Spacing),
    SetWidths(Widths),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EditedTable {
    pub block: String,
    /// Where the cursor goes: in the cell the change is about.
    pub cursor: usize,
}

enum Columns {
    Count(usize),
    Widths(Vec<String>),
}

impl Columns {
    fn len(&self) -> usize {
        match self {
            Columns::Count(n) => *n,
            Columns::Widths(widths) => widths.len(),
        }
    }
}

struct Table {
    columns: Columns,
    /// The table's other settings, as written (like `gutter: 3pt`), custom styles included.
    settings: Vec<String>,
    /// The style's choices; a None is written some other way, and kept in `settings`.
    lines: Option<Lines>,
    fill: Option<(bool, bool)>,
    align: Option<Vec<Align>>,
    spacing: Option<Spacing>,
    header: Option<Vec<String>>,
    rows: Vec<Vec<String>>,
    /// Some when the table is in a figure: its caption, and the figure's other settings.
    figure: Option<(Option<String>, Vec<String>)>,
    /// The cell the cursor is in.
    row: Option<usize>,
    column: Option<usize>,
    /// How the editor shows each cell.
    header_cells: Vec<Cell>,
    cells: Vec<Cell>,
}

pub fn read_table(block: &str) -> Result<TableCells, String> {
    let table = read(block, 0)?;
    let width = table.columns.len();
    Ok(TableCells {
        columns: width,
        header: table.header.as_ref().map(|_| table.header_cells.clone()),
        rows: table.cells.chunks(width).map(|row| row.to_vec()).collect(),
        caption: table.figure.as_ref().and_then(|(caption, _)| caption.clone()),
        style: TableStyle {
            lines: table.lines,
            striped: table.fill.map(|(striped, _)| striped),
            shaded_header: table.fill.map(|(_, shaded)| shaded),
            align: table.align.clone(),
            spacing: table.spacing,
            widths: match &table.columns {
                Columns::Count(_) => Some(Widths::Auto),
                Columns::Widths(widths) if widths.iter().all(|w| w == "1fr") => Some(Widths::Equal),
                Columns::Widths(_) => None,
            },
        },
    })
}

// Each style choice, as Typst. `header` is whether the table has a header row; `last` the last
// row's number (counting the header).

fn stroke_source(lines: Lines, header: bool, last: usize) -> Option<String> {
    match lines {
        Lines::All => None,
        Lines::Rows => Some("(x: none, y: 0.5pt + luma(180))".into()),
        Lines::Academic => Some(format!("{}, bottom: if y == {last} {{ 1pt }})", academic_start(header))),
        Lines::None => Some("none".into()),
    }
}

fn academic_start(header: bool) -> &'static str {
    if header {
        "(x, y) => (top: if y == 0 { 1pt } else if y == 1 { 0.5pt }"
    } else {
        "(x, y) => (top: if y == 0 { 1pt }"
    }
}

fn read_stroke(source: &str, header: bool) -> Option<Lines> {
    if let Some(rest) = source.strip_prefix(academic_start(header)) {
        let last = rest.strip_prefix(", bottom: if y == ")?.strip_suffix(" { 1pt })")?;
        return last.parse::<usize>().ok().map(|_| Lines::Academic);
    }
    [Lines::Rows, Lines::None].into_iter().find(|&lines| stroke_source(lines, header, 0).as_deref() == Some(source))
}

fn fill_source((striped, shaded): (bool, bool), header: bool) -> Option<String> {
    let shaded = shaded && header;
    let source = match (striped, shaded, header) {
        (false, false, _) => return None,
        (false, true, _) => "if y == 0 { luma(235) }",
        (true, true, _) => "if y == 0 { luma(235) } else if calc.even(y) { luma(245) }",
        (true, false, true) => "if y > 0 and calc.even(y) { luma(245) }",
        (true, false, false) => "if calc.odd(y) { luma(245) }",
    };
    Some(format!("(x, y) => {source}"))
}

fn read_fill(source: &str, header: bool) -> Option<(bool, bool)> {
    [(true, false), (false, true), (true, true)]
        .into_iter()
        .find(|&choice| fill_source(choice, header).as_deref() == Some(source))
}

fn align_name(align: Align) -> &'static str {
    match align {
        Align::Left => "left",
        Align::Center => "center",
        Align::Right => "right",
    }
}

fn read_align_name(name: &str) -> Option<Align> {
    [Align::Left, Align::Center, Align::Right].into_iter().find(|&align| align_name(align) == name.trim())
}

fn align_source(align: &[Align]) -> Option<String> {
    let first = *align.first()?;
    if align.iter().all(|&a| a == first) {
        return (first != Align::Left).then(|| align_name(first).to_string());
    }
    Some(format!("({})", align.iter().map(|&a| align_name(a)).collect::<Vec<_>>().join(", ")))
}

fn read_align(source: &str, columns: usize) -> Option<Vec<Align>> {
    if let Some(one) = read_align_name(source) {
        return Some(vec![one; columns]);
    }
    let names = source.strip_prefix('(')?.strip_suffix(')')?;
    let align = names.split(',').filter(|n| !n.trim().is_empty()).map(read_align_name).collect::<Option<Vec<_>>>()?;
    (align.len() == columns).then_some(align)
}

fn inset_source(spacing: Spacing) -> Option<&'static str> {
    match spacing {
        Spacing::Compact => Some("3pt"),
        Spacing::Normal => None,
        Spacing::Roomy => Some("8pt"),
    }
}

fn read_inset(source: &str) -> Option<Spacing> {
    [Spacing::Compact, Spacing::Roomy].into_iter().find(|&s| inset_source(s) == Some(source))
}

/// A choice replaces the setting written by hand, if there was one.
fn drop_setting(settings: &mut Vec<String>, name: &str) {
    settings.retain(|setting| setting.split(':').next().map(str::trim) != Some(name));
}

/// A cell's source for some text: as Typst if it's valid on its own (so *bold* stays bold),
/// otherwise as plain text, with what means something in Typst escaped.
fn cell_source(text: &str) -> String {
    let mut depth = 0i32;
    let balanced = text.chars().all(|c| {
        depth += match c {
            '[' => 1,
            ']' => -1,
            _ => 0,
        };
        depth >= 0
    }) && depth == 0;
    let valid = balanced && check_note(text).iter().all(|problem| problem.severity != "error");
    if valid { format!("[{text}]") } else { content(text) }
}

pub fn table_info(block: &str, cursor: usize) -> Result<TableInfo, String> {
    let table = read(block, cursor)?;
    Ok(TableInfo {
        columns: table.columns.len(),
        rows: table.rows.len(),
        header: table.header.is_some(),
        caption: table.figure.as_ref().and_then(|(caption, _)| caption.clone()),
        row: table.row,
        column: table.column,
    })
}

pub fn edit_table(block: &str, cursor: usize, action: TableAction) -> Result<EditedTable, String> {
    let mut table = read(block, cursor)?;
    let columns = table.columns.len();
    let last_row = table.rows.len().saturating_sub(1);
    let row = table.row;
    let column = table.column.unwrap_or(columns - 1);
    let empty_row = || vec!["[]".to_string(); columns];

    // Which cell the cursor goes to afterwards: (row, column), row None for the header.
    let target: (Option<usize>, usize) = match action {
        TableAction::SetCell { row, column, text } => {
            let cell = match row {
                None => table.header.as_mut().and_then(|cells| cells.get_mut(column)),
                Some(r) => table.rows.get_mut(r).and_then(|cells| cells.get_mut(column)),
            }
            .ok_or("There's no such cell.")?;
            *cell = cell_source(&text);
            (row, column)
        }
        TableAction::AddRowBelow => {
            let at = match row {
                Some(r) => r + 1,
                None if table.column.is_some() => 0,
                None => last_row + 1,
            };
            table.rows.insert(at.min(table.rows.len()), empty_row());
            (Some(at.min(table.rows.len() - 1)), 0)
        }
        TableAction::AddColumnRight => {
            for cells in table.rows.iter_mut().chain(table.header.iter_mut()) {
                cells.insert((column + 1).min(cells.len()), "[]".into());
            }
            if let Some(align) = &mut table.align {
                align.insert((column + 1).min(align.len()), Align::Left);
            }
            table.columns = match table.columns {
                Columns::Count(n) => Columns::Count(n + 1),
                Columns::Widths(mut widths) => {
                    // In a table of equal columns, the new one is equal too.
                    let equal = widths.iter().all(|w| w == "1fr");
                    widths.insert(column + 1, if equal { "1fr" } else { "auto" }.into());
                    Columns::Widths(widths)
                }
            };
            (row.or(if table.header.is_some() && table.column.is_some() { None } else { Some(0) }), column + 1)
        }
        TableAction::DeleteRow => {
            if table.rows.len() <= 1 {
                return Err("A table needs at least one row.".into());
            }
            let at = row.unwrap_or(last_row);
            table.rows.remove(at);
            (Some(at.min(table.rows.len() - 1)), column)
        }
        TableAction::DeleteColumn => {
            if columns <= 1 {
                return Err("A table needs at least one column.".into());
            }
            for cells in table.rows.iter_mut().chain(table.header.iter_mut()) {
                if column < cells.len() {
                    cells.remove(column);
                }
            }
            if let Some(align) = &mut table.align {
                if column < align.len() {
                    align.remove(column);
                }
            }
            if let Columns::Widths(widths) = &mut table.columns {
                widths.remove(column);
            } else {
                table.columns = Columns::Count(columns - 1);
            }
            (row.or(Some(0)), column.min(columns - 2))
        }
        TableAction::ToggleHeader => {
            match table.header.take() {
                Some(header) => table.rows.insert(0, header),
                None if !table.rows.is_empty() => table.header = Some(table.rows.remove(0)),
                None => {}
            }
            (Some(0), 0)
        }
        TableAction::SetCaption(caption) => {
            table.figure = match (caption, table.figure.take()) {
                (None, _) => None,
                (Some(text), Some((_, settings))) => Some((Some(text), settings)),
                (Some(text), None) => Some((Some(text), vec![])),
            };
            (row.or(Some(0)), table.column.unwrap_or(0))
        }
        TableAction::SetLines(lines) => {
            drop_setting(&mut table.settings, "stroke");
            table.lines = Some(lines);
            (row.or(Some(0)), column)
        }
        TableAction::SetStriped(on) => {
            drop_setting(&mut table.settings, "fill");
            table.fill = Some((on, table.fill.is_some_and(|(_, shaded)| shaded)));
            (row.or(Some(0)), column)
        }
        TableAction::SetShadedHeader(on) => {
            drop_setting(&mut table.settings, "fill");
            table.fill = Some((table.fill.is_some_and(|(striped, _)| striped), on));
            (row.or(Some(0)), column)
        }
        TableAction::SetAlign { column: at, align } => {
            if at >= columns {
                return Err("There's no such column.".into());
            }
            drop_setting(&mut table.settings, "align");
            let mut aligned = table.align.take().unwrap_or_else(|| vec![Align::Left; columns]);
            aligned[at] = align;
            table.align = Some(aligned);
            (row.or(Some(0)), at)
        }
        TableAction::SetSpacing(spacing) => {
            drop_setting(&mut table.settings, "inset");
            table.spacing = Some(spacing);
            (row.or(Some(0)), column)
        }
        TableAction::SetWidths(widths) => {
            table.columns = match widths {
                Widths::Auto => Columns::Count(columns),
                Widths::Equal => Columns::Widths(vec!["1fr".into(); columns]),
            };
            (row.or(Some(0)), column)
        }
    };

    let (block, header_starts, cell_starts) = write(&table);
    let start = match target {
        (None, c) => header_starts.get(c).copied(),
        (Some(r), c) => cell_starts.get(r).and_then(|cells| cells.get(c.min(cells.len().saturating_sub(1)))).copied(),
    }
    .unwrap_or(0);
    // Into the cell's brackets, so typing fills it.
    let inside = block[start..].starts_with('[') as usize;
    Ok(EditedTable { cursor: block[..start + inside].encode_utf16().count(), block })
}

fn read(block: &str, cursor: usize) -> Result<Table, String> {
    let source = Source::detached(block);
    let cursor = source.lines().utf16_to_byte(cursor).unwrap_or(block.len());
    let range_of = |node: &typst::syntax::SyntaxNode| -> Option<Range<usize>> {
        source.find(node.span()).map(|linked| linked.range())
    };
    let markup = ast::Markup::from_untyped(source.root()).ok_or(CODE_ONLY)?;
    let call = markup
        .exprs()
        .find_map(|expr| match expr {
            ast::Expr::FuncCall(call) => Some(call),
            _ => None,
        })
        .ok_or("This isn't a table.")?;

    let callee = call.callee().to_untyped().full_text();
    let (table_call, figure) = match callee.as_str() {
        "table" => (call, None),
        "figure" => {
            let mut inner = None;
            let mut caption = None;
            let mut settings = vec![];
            for arg in call.args().items() {
                match arg {
                    ast::Arg::Pos(ast::Expr::FuncCall(table)) if table.callee().to_untyped().full_text() == "table" => {
                        inner = Some(table)
                    }
                    ast::Arg::Named(named) if named.name().as_str() == "caption" => match named.expr() {
                        ast::Expr::ContentBlock(block) => caption = Some(plain_text(block).ok_or(CODE_ONLY)?),
                        _ => return Err(CODE_ONLY.into()),
                    },
                    ast::Arg::Named(named) => settings.push(named.to_untyped().full_text().to_string()),
                    _ => return Err(CODE_ONLY.into()),
                }
            }
            (inner.ok_or("This figure has no table.")?, Some((caption, settings)))
        }
        _ => return Err("This isn't a table.".into()),
    };

    let mut columns = None;
    let mut settings = vec![];
    // The style's settings (name, value), read once the header is known.
    let mut styles: Vec<(String, String)> = vec![];
    let mut header = None;
    let mut header_ranges = vec![];
    let mut header_cells = vec![];
    let mut cells = vec![];
    let mut cell_ranges = vec![];
    let mut cell_views = vec![];
    let view_of = |expr: ast::Expr, range: &Range<usize>| Cell {
        text: match expr {
            ast::Expr::ContentBlock(block) => {
                plain_text(block).unwrap_or_else(|| block.body().to_untyped().full_text().to_string())
            }
            other => other.to_untyped().full_text().to_string(),
        },
        editable: matches!(expr, ast::Expr::ContentBlock(_)),
        start: block[..range.start].encode_utf16().count(),
    };
    for arg in table_call.args().items() {
        match arg {
            ast::Arg::Named(named) if named.name().as_str() == "columns" => {
                columns = Some(match named.expr() {
                    ast::Expr::Int(n) if n.get() > 0 => Columns::Count(n.get() as usize),
                    ast::Expr::Array(widths) => Columns::Widths(
                        widths
                            .items()
                            .map(|item| match item {
                                ast::ArrayItem::Pos(width) => Ok(width.to_untyped().full_text().to_string()),
                                _ => Err(CODE_ONLY),
                            })
                            .collect::<Result<_, _>>()?,
                    ),
                    _ => return Err(CODE_ONLY.into()),
                });
            }
            ast::Arg::Named(named) => {
                let name = named.name().as_str();
                let value = named.expr().to_untyped().full_text().to_string();
                match name {
                    "stroke" | "fill" | "align" | "inset" => styles.push((name.to_string(), value)),
                    _ => settings.push(named.to_untyped().full_text().to_string()),
                }
            }
            ast::Arg::Pos(ast::Expr::FuncCall(inner)) if inner.callee().to_untyped().full_text() == "table.header" => {
                let mut texts = vec![];
                for item in inner.args().items() {
                    let ast::Arg::Pos(cell) = item else { return Err(CODE_ONLY.into()) };
                    let range = range_of(cell.to_untyped()).ok_or(CODE_ONLY)?;
                    header_cells.push(view_of(cell, &range));
                    header_ranges.push(range);
                    texts.push(cell.to_untyped().full_text().to_string());
                }
                header = Some(texts);
            }
            ast::Arg::Pos(ast::Expr::FuncCall(inner)) if inner.callee().to_untyped().full_text().starts_with("table.") => {
                return Err(CODE_ONLY.into());
            }
            ast::Arg::Pos(cell) => {
                let range = range_of(cell.to_untyped()).ok_or(CODE_ONLY)?;
                cell_views.push(view_of(cell, &range));
                cell_ranges.push(range);
                cells.push(cell.to_untyped().full_text().to_string());
            }
            ast::Arg::Spread(_) => return Err(CODE_ONLY.into()),
        }
    }
    let columns = columns.ok_or(CODE_ONLY)?;
    let width = columns.len();

    let touches = |range: &Range<usize>| range.start <= cursor && cursor <= range.end;
    let (mut row, mut column) = (None, None);
    if let Some(index) = cell_ranges.iter().position(touches) {
        row = Some(index / width);
        column = Some(index % width);
    } else if let Some(index) = header_ranges.iter().position(touches) {
        column = Some(index.min(width - 1));
    }

    // Short last rows are filled with empty cells.
    while cells.len() % width != 0 {
        cells.push("[]".into());
        cell_views.push(Cell { text: String::new(), editable: true, start: 0 });
    }
    let rows = cells.chunks(width).map(|row| row.to_vec()).collect();

    // Each style setting is one of the choices, or kept as written.
    let has_header = header.is_some();
    let (mut lines, mut fill, mut align, mut spacing) =
        (Some(Lines::All), Some((false, false)), Some(vec![Align::Left; width]), Some(Spacing::Normal));
    for (name, value) in styles {
        let read = match name.as_str() {
            "stroke" => read_stroke(&value, has_header).map(|l| lines = Some(l)),
            "fill" => read_fill(&value, has_header).map(|f| fill = Some(f)),
            "align" => read_align(&value, width).map(|a| align = Some(a)),
            _ => read_inset(&value).map(|s| spacing = Some(s)),
        };
        if read.is_none() {
            match name.as_str() {
                "stroke" => lines = None,
                "fill" => fill = None,
                "align" => align = None,
                _ => spacing = None,
            }
            settings.push(format!("{name}: {value}"));
        }
    }
    Ok(Table {
        columns,
        settings,
        lines,
        fill,
        align,
        spacing,
        header,
        rows,
        figure,
        row,
        column,
        header_cells,
        cells: cell_views,
    })
}

/// The table written out, with where each header cell and body cell starts (byte offsets).
fn write(table: &Table) -> (String, Vec<usize>, Vec<Vec<usize>>) {
    let indent = if table.figure.is_some() { "    " } else { "  " };
    let mut out = String::new();
    if table.figure.is_some() {
        out.push_str("#figure(\n  table(\n");
    } else {
        out.push_str("#table(\n");
    }
    let columns = match &table.columns {
        Columns::Count(n) => n.to_string(),
        Columns::Widths(widths) => format!("({})", widths.join(", ")),
    };
    out.push_str(&format!("{indent}columns: {columns},\n"));
    let header = table.header.is_some();
    let last = table.rows.len() + header as usize - 1;
    let styles = [
        ("align", table.align.as_deref().and_then(align_source)),
        ("inset", table.spacing.and_then(inset_source).map(String::from)),
        ("stroke", table.lines.and_then(|lines| stroke_source(lines, header, last))),
        ("fill", table.fill.and_then(|fill| fill_source(fill, header))),
    ];
    for (name, value) in styles {
        if let Some(value) = value {
            out.push_str(&format!("{indent}{name}: {value},\n"));
        }
    }
    for setting in &table.settings {
        out.push_str(&format!("{indent}{setting},\n"));
    }

    let mut header_starts = vec![];
    if let Some(header) = &table.header {
        out.push_str(indent);
        out.push_str("table.header(");
        for (i, cell) in header.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            header_starts.push(out.len());
            out.push_str(cell);
        }
        out.push_str("),\n");
    }
    let mut cell_starts = vec![];
    for row in &table.rows {
        out.push_str(indent);
        let mut starts = vec![];
        for (i, cell) in row.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            starts.push(out.len());
            out.push_str(cell);
        }
        out.push_str(",\n");
        cell_starts.push(starts);
    }

    match &table.figure {
        Some((caption, settings)) => {
            out.push_str("  ),\n");
            if let Some(caption) = caption {
                out.push_str(&format!("  caption: {},\n", content(caption)));
            }
            for setting in settings {
                out.push_str(&format!("  {setting},\n"));
            }
            out.push(')');
        }
        None => out.push(')'),
    }
    (out, header_starts, cell_starts)
}
