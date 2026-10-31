//! Page settings for Typst notes: paper, orientation, columns, margins, font and text size.
//! Stored as ordinary Typst code at the top of the note (`#set page(…)`, `#set text(…)`), so the
//! note stays a normal Typst file. Only settings written in a simple way are edited here; any
//! other way of writing them is "left to the code" and never touched.

use crate::notes::NoteFormat;
use crate::properties::find_block;
use serde::{Deserialize, Serialize};
use std::ops::Range;
use typst::syntax::ast::{self, AstNode, Unit};
use typst::syntax::{SyntaxKind, SyntaxNode};

pub use crate::typst_world::font_families;

/// The settings the popover can edit. `None` means Typst's default.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSettings {
    pub paper: Option<String>,
    pub landscape: Option<bool>,
    pub columns: Option<u32>,
    pub margin_cm: Option<f64>,
    pub font: Option<String>,
    pub text_size_pt: Option<f64>,
    /// Even edges on both sides, like a printed paper.
    pub justify: Option<bool>,
    /// The space between lines, relative to the text size (Typst's default is 0.65em).
    pub line_spacing_em: Option<f64>,
    pub first_line_indent_em: Option<f64>,
    /// Like "es": sets hyphenation and quotation marks for the language.
    pub language: Option<String>,
    /// How pages are numbered, as a Typst numbering pattern like "1" or "1 / 1".
    pub page_numbers: Option<String>,
    /// Plain text at the top or bottom of every page.
    pub header: Option<String>,
    pub footer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReadPageSettings {
    pub values: PageSettings,
    /// Settings written in a way the popover can't edit (e.g. "margin"): left to the code.
    pub locked: Vec<String>,
}

/// One change from the popover. `None` goes back to Typst's default.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "setting", content = "value", rename_all = "camelCase")]
pub enum PageSetting {
    Paper(Option<String>),
    Landscape(Option<bool>),
    Columns(Option<u32>),
    MarginCm(Option<f64>),
    Font(Option<String>),
    TextSizePt(Option<f64>),
    Justify(Option<bool>),
    LineSpacingEm(Option<f64>),
    FirstLineIndentEm(Option<f64>),
    Language(Option<String>),
    PageNumbers(Option<String>),
    Header(Option<String>),
    Footer(Option<String>),
}

/// Which `#set` rule and argument each setting lives in.
#[derive(Clone, Copy, PartialEq)]
enum Field {
    Paper,
    Landscape,
    Columns,
    Margin,
    Font,
    TextSize,
    Justify,
    LineSpacing,
    FirstLineIndent,
    Language,
    PageNumbers,
    Header,
    Footer,
}

const FIELDS: [Field; 13] = [
    Field::Paper,
    Field::Landscape,
    Field::Columns,
    Field::Margin,
    Field::Font,
    Field::TextSize,
    Field::Justify,
    Field::LineSpacing,
    Field::FirstLineIndent,
    Field::Language,
    Field::PageNumbers,
    Field::Header,
    Field::Footer,
];

impl Field {
    fn target(self) -> &'static str {
        match self {
            Field::Font | Field::TextSize | Field::Language => "text",
            Field::Justify | Field::LineSpacing | Field::FirstLineIndent => "par",
            _ => "page",
        }
    }

    fn argument(self) -> &'static str {
        match self {
            Field::Paper => "paper",
            Field::Landscape => "flipped",
            Field::Columns => "columns",
            Field::Margin => "margin",
            Field::Font => "font",
            Field::TextSize => "size",
            Field::Justify => "justify",
            Field::LineSpacing => "leading",
            Field::FirstLineIndent => "first-line-indent",
            Field::Language => "lang",
            Field::PageNumbers => "numbering",
            Field::Header => "header",
            Field::Footer => "footer",
        }
    }

    /// The name the frontend uses for it.
    fn name(self) -> &'static str {
        match self {
            Field::Paper => "paper",
            Field::Landscape => "landscape",
            Field::Columns => "columns",
            Field::Margin => "margin",
            Field::Font => "font",
            Field::TextSize => "textSize",
            Field::Justify => "justify",
            Field::LineSpacing => "lineSpacing",
            Field::FirstLineIndent => "firstLineIndent",
            Field::Language => "language",
            Field::PageNumbers => "pageNumbers",
            Field::Header => "header",
            Field::Footer => "footer",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Field::Paper => "paper size",
            Field::Landscape => "orientation",
            Field::Columns => "number of columns",
            Field::Margin => "margin",
            Field::Font => "font",
            Field::TextSize => "text size",
            Field::Justify => "justification",
            Field::LineSpacing => "line spacing",
            Field::FirstLineIndent => "first-line indent",
            Field::Language => "language",
            Field::PageNumbers => "page numbering",
            Field::Header => "header",
            Field::Footer => "footer",
        }
    }
}

/// A top-level `#set page(…)` or `#set text(…)` rule, with where its parts are in the note.
struct Rule<'a> {
    target: String,
    conditional: bool,
    /// From the `#` to the closing `)`.
    range: Range<usize>,
    /// The `(…)`.
    args: Range<usize>,
    named: Vec<Named<'a>>,
    /// How many arguments it has, named or not.
    items: usize,
}

struct Named<'a> {
    name: String,
    expr_range: Range<usize>,
    expr: ast::Expr<'a>,
    /// Where to cut when removing it, along with the comma next to it.
    removal: Range<usize>,
}

fn rules(root: &SyntaxNode) -> Vec<Rule<'_>> {
    let mut rules = vec![];
    let mut offset = 0;
    for child in root.children() {
        let start = offset;
        offset += child.len();
        let Some(rule) = ast::SetRule::from_untyped(child) else { continue };
        let ast::Expr::Ident(target) = rule.target() else { continue };
        let Some((args_offset, args_node)) = with_offsets(child, start)
            .into_iter()
            .find(|(_, node)| node.kind() == SyntaxKind::Args)
        else {
            continue;
        };
        let args_children = with_offsets(args_node, args_offset);
        let items: Vec<usize> = (0..args_children.len())
            .filter(|&i| {
                let kind = args_children[i].1.kind();
                !matches!(kind, SyntaxKind::LeftParen | SyntaxKind::RightParen | SyntaxKind::Comma)
                    && !kind.is_trivia()
            })
            .collect();
        let named = items
            .iter()
            .filter_map(|&i| {
                let (at, node) = args_children[i];
                let named = ast::Named::from_untyped(node)?;
                let expr = named.expr();
                let expr_start = at + node.len() - expr.to_untyped().len();
                Some(Named {
                    name: named.name().as_str().to_string(),
                    expr_range: expr_start..at + node.len(),
                    expr,
                    removal: removal_range(&args_children, i),
                })
            })
            .collect();
        rules.push(Rule {
            target: target.as_str().to_string(),
            conditional: rule.condition().is_some(),
            // The `#` before `set` belongs to the rule too.
            range: start.saturating_sub(1)..offset,
            args: args_offset..args_offset + args_node.len(),
            named,
            items: items.len(),
        });
    }
    rules
}

fn with_offsets(node: &SyntaxNode, start: usize) -> Vec<(usize, &SyntaxNode)> {
    let mut offset = start;
    node.children()
        .map(|child| {
            let at = offset;
            offset += child.len();
            (at, child)
        })
        .collect()
}

/// An argument with the comma after it (or, if it's last, the comma before it).
fn removal_range(children: &[(usize, &SyntaxNode)], index: usize) -> Range<usize> {
    let (at, node) = children[index];
    let end = at + node.len();
    let next = children[index + 1..].iter().find(|(_, n)| !n.kind().is_trivia());
    if let Some((comma_at, comma)) = next.filter(|(_, n)| n.kind() == SyntaxKind::Comma) {
        let after_comma = comma_at + comma.len();
        let spaces: usize = children
            .iter()
            .skip_while(|(o, _)| *o < after_comma)
            .take_while(|(_, n)| n.kind() == SyntaxKind::Space)
            .map(|(_, n)| n.len())
            .sum();
        return at..after_comma + spaces;
    }
    let previous = children[..index].iter().rev().find(|(_, n)| !n.kind().is_trivia());
    match previous {
        Some((comma_at, comma)) if comma.kind() == SyntaxKind::Comma => *comma_at..end,
        _ => at..end,
    }
}

fn length_in(expr: &ast::Expr, unit_size: impl Fn(Unit) -> Option<f64>) -> Option<f64> {
    let ast::Expr::Numeric(numeric) = expr else { return None };
    let (value, unit) = numeric.get();
    Some(value * unit_size(unit)?)
}

/// Points per unit, centimetres per unit.
fn points_per(unit: Unit) -> Option<f64> {
    match unit {
        Unit::Pt => Some(1.0),
        Unit::Mm => Some(72.0 / 25.4),
        Unit::Cm => Some(72.0 / 2.54),
        Unit::In => Some(72.0),
        _ => None,
    }
}

/// Only lengths relative to the text size (em) are edited as line spacing or indents.
fn ems(unit: Unit) -> Option<f64> {
    matches!(unit, Unit::Em).then_some(1.0)
}

fn centimetres_per(unit: Unit) -> Option<f64> {
    points_per(unit).map(|points| points * 2.54 / 72.0)
}

/// Reads the value if it's written simply; `Err` if it's written in another way.
fn read_value(field: Field, expr: &ast::Expr, settings: &mut PageSettings) -> Result<(), ()> {
    let round = |n: f64| (n * 100.0).round() / 100.0;
    match (field, expr) {
        (Field::Paper, ast::Expr::Str(text)) => settings.paper = Some(text.get().to_string()),
        (Field::Landscape, ast::Expr::Bool(flag)) => settings.landscape = Some(flag.get()),
        (Field::Columns, ast::Expr::Int(n)) if n.get() > 0 => settings.columns = Some(n.get() as u32),
        (Field::Margin, expr) => settings.margin_cm = Some(round(length_in(expr, centimetres_per).ok_or(())?)),
        (Field::Font, ast::Expr::Str(text)) => settings.font = Some(text.get().to_string()),
        (Field::TextSize, expr) => settings.text_size_pt = Some(round(length_in(expr, points_per).ok_or(())?)),
        (Field::Justify, ast::Expr::Bool(flag)) => settings.justify = Some(flag.get()),
        (Field::LineSpacing, expr) => settings.line_spacing_em = Some(round(length_in(expr, ems).ok_or(())?)),
        (Field::FirstLineIndent, expr) => settings.first_line_indent_em = Some(round(length_in(expr, ems).ok_or(())?)),
        (Field::Language, ast::Expr::Str(text)) => settings.language = Some(text.get().to_string()),
        (Field::PageNumbers, ast::Expr::Str(text)) => settings.page_numbers = Some(text.get().to_string()),
        (Field::Header, ast::Expr::ContentBlock(block)) => settings.header = Some(plain_text(*block).ok_or(())?),
        (Field::Footer, ast::Expr::ContentBlock(block)) => settings.footer = Some(plain_text(*block).ok_or(())?),
        _ => return Err(()),
    }
    Ok(())
}

/// The note's page settings, and which ones are left to its code.
pub fn read_page_settings(note: &str) -> ReadPageSettings {
    let root = typst::syntax::parse(note);
    let rules = rules(&root);
    let mut settings = ReadPageSettings { values: PageSettings::default(), locked: vec![] };
    for field in FIELDS {
        match find_setting(&rules, field) {
            Setting::Unset => {}
            Setting::Ours(_, named) => {
                if read_value(field, &named.expr, &mut settings.values).is_err() {
                    settings.locked.push(field.name().into());
                }
            }
            Setting::Locked => settings.locked.push(field.name().into()),
        }
    }
    settings
}

enum Setting<'r, 'a> {
    Unset,
    /// Set once, in the first plain rule for its target: the one the popover edits.
    Ours(&'r Rule<'a>, &'r Named<'a>),
    /// Set several times, or in a conditional rule: left to the code.
    Locked,
}

fn our_rule<'r, 'a>(rules: &'r [Rule<'a>], target: &str) -> Option<&'r Rule<'a>> {
    rules.iter().find(|rule| rule.target == target && !rule.conditional)
}

fn find_setting<'r, 'a>(rules: &'r [Rule<'a>], field: Field) -> Setting<'r, 'a> {
    let places: Vec<(&Rule, &Named)> = rules
        .iter()
        .filter(|rule| rule.target == field.target())
        .flat_map(|rule| rule.named.iter().map(move |named| (rule, named)))
        .filter(|(_, named)| named.name == field.argument())
        .collect();
    match places.as_slice() {
        [] => Setting::Unset,
        [(rule, named)] if our_rule(rules, field.target()).is_some_and(|ours| std::ptr::eq(ours, *rule)) => {
            Setting::Ours(rule, named)
        }
        _ => Setting::Locked,
    }
}

/// The note with one setting changed, written into its `#set` rules.
pub fn change_page_setting(note: &str, setting: PageSetting) -> Result<String, String> {
    let (field, value) = match setting {
        PageSetting::Paper(paper) => (Field::Paper, paper.map(|p| quoted(&p))),
        // Portrait is the default, so it isn't written.
        PageSetting::Landscape(landscape) => (Field::Landscape, landscape.filter(|l| *l).map(|_| "true".into())),
        PageSetting::Columns(columns) => (Field::Columns, columns.map(|c| c.to_string())),
        PageSetting::MarginCm(margin) => (Field::Margin, margin.map(|m| format!("{}cm", number(m)))),
        PageSetting::Font(font) => (Field::Font, font.map(|f| quoted(&f))),
        PageSetting::TextSizePt(size) => (Field::TextSize, size.map(|s| format!("{}pt", number(s)))),
        // Not justifying is the default, so it isn't written.
        PageSetting::Justify(justify) => (Field::Justify, justify.filter(|j| *j).map(|_| "true".into())),
        PageSetting::LineSpacingEm(spacing) => (Field::LineSpacing, spacing.map(|s| format!("{}em", number(s)))),
        PageSetting::FirstLineIndentEm(indent) => (Field::FirstLineIndent, indent.map(|i| format!("{}em", number(i)))),
        PageSetting::Language(language) => (Field::Language, language.map(|l| quoted(&l))),
        PageSetting::PageNumbers(pattern) => (Field::PageNumbers, pattern.map(|p| quoted(&p))),
        PageSetting::Header(text) => (Field::Header, text.map(|t| content(&t))),
        PageSetting::Footer(text) => (Field::Footer, text.map(|t| content(&t))),
    };
    if read_page_settings(note).locked.iter().any(|name| name == field.name()) {
        return Err(format!("The {} is set in the note's code; change it there.", field.label()));
    }
    let root = typst::syntax::parse(note);
    let rules = rules(&root);
    let edit = |range: Range<usize>, text: &str| format!("{}{text}{}", &note[..range.start], &note[range.end..]);
    let argument = |value: &str| format!("{}: {value}", field.argument());

    Ok(match (find_setting(&rules, field), value) {
        (Setting::Locked, _) => {
            return Err(format!("The {} is set in the note's code; change it there.", field.label()));
        }
        (Setting::Ours(_, named), Some(value)) => edit(named.expr_range.clone(), &value),
        (Setting::Ours(rule, _), None) if rule.items == 1 => {
            // It was the rule's only setting: remove the whole line.
            let end = if note[rule.range.end..].starts_with('\n') { rule.range.end + 1 } else { rule.range.end };
            edit(rule.range.start..end, "")
        }
        (Setting::Ours(_, named), None) => edit(named.removal.clone(), ""),
        (Setting::Unset, None) => note.to_string(),
        (Setting::Unset, Some(value)) => match our_rule(&rules, field.target()) {
            Some(rule) => {
                let inside = &note[rule.args.start + 1..rule.args.end - 1];
                let content = inside.trim_end();
                let at = rule.args.start + 1 + content.len();
                let text = if content.is_empty() {
                    argument(&value)
                } else if content.ends_with(',') {
                    format!(" {},", argument(&value))
                } else {
                    format!(", {}", argument(&value))
                };
                edit(at..at, &text)
            }
            None => {
                let rule = format!("#set {}({})", field.target(), argument(&value));
                insert_rule(note, &rules, field.target(), &rule)
            }
        },
    })
}

/// New rules go at the top, after the note's properties, in the order page, text, paragraph.
fn insert_rule(note: &str, rules: &[Rule], target: &str, rule: &str) -> String {
    let after = |end: usize| {
        if note[end..].starts_with('\n') {
            format!("{}{rule}\n{}", &note[..end + 1], &note[end + 1..])
        } else {
            format!("{}\n{rule}{}", &note[..end], &note[end..])
        }
    };
    let before_it: &[&str] = match target {
        "par" => &["text", "page"],
        "text" => &["page"],
        _ => &[],
    };
    if let Some(previous) = before_it.iter().find_map(|t| our_rule(rules, t)) {
        return after(previous.range.end);
    }
    match find_block(note, NoteFormat::Typst) {
        Some(properties) => after(properties.end),
        None => format!("{rule}\n{note}"),
    }
}

/// The text of a `[…]` that's only text (escaped characters included), or None if it has more.
pub(crate) fn plain_text(block: ast::ContentBlock) -> Option<String> {
    let mut text = String::new();
    for node in block.body().to_untyped().children() {
        match node.kind() {
            SyntaxKind::Text => text.push_str(node.full_text().as_str()),
            SyntaxKind::Space => text.push(' '),
            SyntaxKind::Escape => {
                let escaped = node.full_text();
                let mut chars = escaped.chars().skip(1);
                match (chars.next(), chars.next()) {
                    (Some(c), None) => text.push(c),
                    _ => return None,
                }
            }
            _ => return None,
        }
    }
    Some(text)
}

/// Plain text as `[…]` content: characters that mean something in Typst are escaped.
pub(crate) fn content(text: &str) -> String {
    let mut out = String::from("[");
    for c in text.replace('\n', " ").chars() {
        if "\\[]#$*_@<>`=-+/~'\"".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out.push(']');
    out
}

fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

fn number(n: f64) -> String {
    if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{}", (n * 100.0).round() / 100.0) }
}
