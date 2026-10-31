//! A note's properties: information about it (authors, year, tags…), with no fixed fields.
//! Markdown notes keep them in `---` frontmatter at the top; Typst notes in
//! `#metadata((…)) <properties>` at the top, which Typst itself can query.
//!
//! Properties the user didn't change are written back exactly as they were (spacing, comments
//! and all), so editing one value never reformats the rest.

use crate::files::{list_files, EntryKind, FileEntry};
use crate::notes::NoteFormat;
use std::collections::HashMap;
use std::path::Path;
use crate::typst_world::readable;
use serde::{Deserialize, Serialize};
use std::ops::Range;
use typst::syntax::ast::{self, AstNode};
use typst::syntax::SyntaxKind;
use yaml_rust2::{Yaml, YamlLoader};

/// A value's type comes from how it's written: `2017` is a number, `"2017"` is text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum Value {
    Text(String),
    Number(f64),
    #[serde(rename = "boolean")]
    Bool(bool),
    /// `YYYY-MM-DD`.
    Date(String),
    List(Vec<String>),
    /// Something the table can't edit (like a nested group); kept exactly as written.
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Property {
    pub key: String,
    pub value: Value,
    /// The property as written in the note, while it's unchanged. Written back as is.
    pub raw: Option<String>,
}

/// Where the note's properties block is (byte offsets), if it has one at its very top.
pub fn find_block(note: &str, format: NoteFormat) -> Option<Range<usize>> {
    match format {
        NoteFormat::Markdown => find_frontmatter(note),
        NoteFormat::Typst => find_metadata(note),
    }
}

/// The properties written in a block (the text `find_block` points at).
pub fn parse_block(block: &str, format: NoteFormat) -> Result<Vec<Property>, String> {
    match format {
        NoteFormat::Markdown => parse_frontmatter(block),
        NoteFormat::Typst => parse_metadata(block),
    }
}

/// The block for these properties; empty if there are none (the note then has no block).
pub fn write_block(properties: &[Property], format: NoteFormat) -> String {
    if properties.is_empty() {
        return String::new();
    }
    match format {
        NoteFormat::Markdown => {
            let lines: Vec<String> = properties.iter().map(yaml_entry).collect();
            format!("---\n{}\n---", lines.join("\n"))
        }
        NoteFormat::Typst => {
            let items: String = properties.iter().map(|p| format!("  {},\n", typst_entry(p))).collect();
            format!("#metadata((\n{items})) <properties>")
        }
    }
}

// --- Markdown frontmatter -------------------------------------------------------------------

fn find_frontmatter(note: &str) -> Option<Range<usize>> {
    let first_line_end = note.find('\n')?;
    if note[..first_line_end].trim_end_matches('\r') != "---" {
        return None;
    }
    let mut offset = first_line_end + 1;
    for line in note[offset..].split('\n') {
        let content = line.trim_end_matches('\r');
        if content == "---" || content == "..." {
            return Some(0..offset + content.len());
        }
        offset += line.len() + 1;
    }
    None
}

/// The lines between the `---` delimiters.
fn frontmatter_body(block: &str) -> Vec<&str> {
    let lines: Vec<&str> = block.lines().collect();
    if lines.len() < 2 {
        return vec![];
    }
    lines[1..lines.len() - 1].to_vec()
}

fn parse_frontmatter(block: &str) -> Result<Vec<Property>, String> {
    let body = frontmatter_body(block);
    YamlLoader::load_from_str(&body.join("\n"))
        .map_err(|error| format!("The properties have a mistake: {error}"))?;
    entries(&body)
        .into_iter()
        .map(|raw| {
            let documents = YamlLoader::load_from_str(&raw).map_err(|e| e.to_string())?;
            let Some(Yaml::Hash(hash)) = documents.into_iter().next() else {
                return Err("The properties have a mistake.".to_string());
            };
            let (key, value) = hash.into_iter().next().ok_or("The properties have a mistake.")?;
            Ok(Property { key: yaml_scalar(&key).unwrap_or_default(), value: yaml_value(value, &raw), raw: Some(raw) })
        })
        .collect()
}

/// Splits the frontmatter into one piece of text per property. Comments and blank lines stay
/// with the property they're next to, so they're kept when that property is.
fn entries(body: &[&str]) -> Vec<String> {
    let starts_entry = |line: &str| {
        let first = line.chars().next();
        first.is_some_and(|c| !c.is_whitespace() && c != '#' && c != '-') && line.contains(':')
    };
    let mut entries: Vec<Vec<&str>> = vec![];
    let mut pending: Vec<&str> = vec![]; // comments before the first property, or between two
    for line in body {
        if starts_entry(line) {
            let mut entry = std::mem::take(&mut pending);
            entry.push(line);
            entries.push(entry);
        } else if line.starts_with(char::is_whitespace) || line.starts_with('-') {
            // A continuation (indented value or list item) belongs to the property above.
            match entries.last_mut() {
                Some(entry) if pending.is_empty() => entry.push(line),
                _ => pending.push(line),
            }
        } else {
            pending.push(line);
        }
    }
    if let Some(last) = entries.last_mut() {
        last.extend(pending);
    }
    entries.into_iter().map(|lines| lines.join("\n")).collect()
}

fn yaml_scalar(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(text) => Some(text.clone()),
        Yaml::Integer(number) => Some(number.to_string()),
        Yaml::Real(number) => Some(number.clone()),
        Yaml::Boolean(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn yaml_value(value: Yaml, raw: &str) -> Value {
    match value {
        Yaml::String(text) => {
            let quoted = raw.contains(&format!("\"{text}\"")) || raw.contains(&format!("'{text}'"));
            if !quoted && is_date(&text) {
                Value::Date(text)
            } else {
                Value::Text(text)
            }
        }
        Yaml::Integer(number) => Value::Number(number as f64),
        Yaml::Real(number) => number.parse().map_or(Value::Other, Value::Number),
        Yaml::Boolean(flag) => Value::Bool(flag),
        Yaml::Null => Value::Text(String::new()),
        Yaml::Array(items) => items
            .iter()
            .map(yaml_scalar)
            .collect::<Option<Vec<_>>>()
            .map_or(Value::Other, Value::List),
        _ => Value::Other,
    }
}

fn yaml_entry(property: &Property) -> String {
    if let Some(raw) = &property.raw {
        return raw.clone();
    }
    let value = match &property.value {
        Value::Text(text) => yaml_text(text, false),
        Value::Number(number) => number_text(*number),
        Value::Bool(flag) => flag.to_string(),
        Value::Date(date) => date.clone(),
        Value::List(items) => {
            let items: Vec<String> = items.iter().map(|item| yaml_text(item, true)).collect();
            format!("[{}]", items.join(", "))
        }
        Value::Other => "null".into(),
    };
    let key = if is_plain_yaml_key(&property.key) { property.key.clone() } else { quoted(&property.key) };
    format!("{key}: {value}")
}

/// Plain text when it can't be misread; quoted otherwise ("yes", "2017", "a: b"…).
fn yaml_text(text: &str, in_list: bool) -> String {
    let special = ["yes", "no", "true", "false", "null", "on", "off", "y", "n", "~"];
    let plain = text.starts_with(|c: char| c.is_alphabetic())
        && !text.ends_with(' ')
        && !special.contains(&text.to_lowercase().as_str())
        && !text.chars().any(|c| ":#[]{}\"'\n\r\t\\|>&*!%@`".contains(c) || (in_list && c == ','));
    if plain { text.to_string() } else { quoted(text) }
}

fn is_plain_yaml_key(key: &str) -> bool {
    key.starts_with(|c: char| c.is_alphabetic() || c == '_')
        && !key.ends_with(' ')
        && key.chars().all(|c| c.is_alphanumeric() || " _-".contains(c))
}

// --- Typst metadata -------------------------------------------------------------------------

/// `#metadata(…) <properties>` as the first thing in the note.
fn find_metadata(note: &str) -> Option<Range<usize>> {
    if !note.starts_with("#metadata(") {
        return None;
    }
    let root = typst::syntax::parse(note);
    let mut offset = 0;
    for (index, child) in root.children().enumerate() {
        offset += child.len();
        match (index, child.kind()) {
            (0, SyntaxKind::Hash) => {}
            (1, SyntaxKind::FuncCall) => {}
            (_, SyntaxKind::Space) if index >= 2 && !child.full_text().contains('\n') => {}
            (_, SyntaxKind::Label) if index >= 2 => {
                return (child.full_text() == "<properties>").then_some(0..offset);
            }
            _ => return None,
        }
    }
    None
}

fn parse_metadata(block: &str) -> Result<Vec<Property>, String> {
    let root = typst::syntax::parse(block);
    if let Some(error) = root.errors_and_warnings().0.first() {
        return Err(format!("The properties have a mistake: {}", readable(&error.message)));
    }
    let markup = ast::Markup::from_untyped(&root).ok_or("The properties have a mistake.")?;
    let call = markup
        .exprs()
        .find_map(|expr| match expr {
            ast::Expr::FuncCall(call) => Some(call),
            _ => None,
        })
        .ok_or("The properties should be written as #metadata((…)).")?;
    let dict = call
        .args()
        .items()
        .find_map(|arg| match arg {
            ast::Arg::Pos(ast::Expr::Dict(dict)) => Some(dict),
            _ => None,
        })
        .ok_or("The properties should be written as #metadata((name: value, …)).")?;

    dict.items()
        .map(|item| {
            let raw = item.to_untyped().full_text().to_string();
            let (key, expr) = match item {
                ast::DictItem::Named(named) => (named.name().as_str().to_string(), named.expr()),
                ast::DictItem::Keyed(keyed) => match keyed.key() {
                    ast::Expr::Str(key) => (key.get().to_string(), keyed.expr()),
                    _ => return Err("Property names should be words or \"quoted text\".".to_string()),
                },
                ast::DictItem::Spread(_) => {
                    return Err("The properties can't use `..` here.".to_string());
                }
            };
            Ok(Property { key, value: typst_value(expr), raw: Some(raw) })
        })
        .collect()
}

fn typst_value(expr: ast::Expr) -> Value {
    match expr {
        ast::Expr::Str(text) => Value::Text(text.get().to_string()),
        ast::Expr::Int(number) => Value::Number(number.get() as f64),
        ast::Expr::Float(number) => Value::Number(number.get()),
        ast::Expr::Bool(flag) => Value::Bool(flag.get()),
        ast::Expr::Array(array) => array
            .items()
            .map(|item| match item {
                ast::ArrayItem::Pos(ast::Expr::Str(text)) => Some(text.get().to_string()),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
            .map_or(Value::Other, Value::List),
        ast::Expr::FuncCall(call) => typst_date(call).map_or(Value::Other, Value::Date),
        _ => Value::Other,
    }
}

/// `datetime(year: 2017, month: 6, day: 12)` as `2017-06-12`.
fn typst_date(call: ast::FuncCall) -> Option<String> {
    let ast::Expr::Ident(callee) = call.callee() else { return None };
    if callee.as_str() != "datetime" {
        return None;
    }
    let (mut year, mut month, mut day) = (None, None, None);
    for arg in call.args().items() {
        let ast::Arg::Named(named) = arg else { return None };
        let ast::Expr::Int(number) = named.expr() else { return None };
        match named.name().as_str() {
            "year" => year = Some(number.get()),
            "month" => month = Some(number.get()),
            "day" => day = Some(number.get()),
            _ => return None,
        }
    }
    Some(format!("{:04}-{:02}-{:02}", year?, month?, day?))
}

fn typst_entry(property: &Property) -> String {
    if let Some(raw) = &property.raw {
        return raw.clone();
    }
    let value = match &property.value {
        Value::Text(text) => quoted(text),
        Value::Number(number) => number_text(*number),
        Value::Bool(flag) => flag.to_string(),
        Value::Date(date) => match date.split('-').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>() {
            Ok(parts) if parts.len() == 3 => {
                format!("datetime(year: {}, month: {}, day: {})", parts[0], parts[1], parts[2])
            }
            _ => quoted(date),
        },
        Value::List(items) => match items.as_slice() {
            [] => "()".into(),
            // A one-item array needs its comma, or it's just text in brackets.
            [only] => format!("({},)", quoted(only)),
            _ => format!("({})", items.iter().map(|item| quoted(item)).collect::<Vec<_>>().join(", ")),
        },
        Value::Other => "none".into(),
    };
    let key = if is_typst_identifier(&property.key) { property.key.clone() } else { quoted(&property.key) };
    format!("{key}: {value}")
}

fn is_typst_identifier(key: &str) -> bool {
    const KEYWORDS: [&str; 22] = [
        "none", "auto", "true", "false", "not", "and", "or", "let", "set", "show", "context", "if",
        "else", "for", "in", "while", "break", "continue", "return", "import", "include", "as",
    ];
    key.starts_with(|c: char| c.is_alphabetic() || c == '_')
        && key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        && !KEYWORDS.contains(&key)
}

// --- Shared -----------------------------------------------------------------------------------

/// Double-quoted, with escapes. The same text works in both YAML and Typst.
fn quoted(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn number_text(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{}", number as i64)
    } else {
        number.to_string()
    }
}

fn is_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() })
}

// --- Suggestions ------------------------------------------------------------------------------

/// A property name used in the workspace, for suggestions (and later, table views).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct KnownProperty {
    pub key: String,
    /// The type it's most often given: "text", "number", "boolean", "date" or "list".
    pub kind: String,
    /// How many notes use it (0 for the common names suggested to everyone).
    pub notes: usize,
    /// Text values and list items it has in notes, most used first.
    pub values: Vec<String>,
}

/// Names most notes use, with their usual type, suggested even before any note has them.
const COMMON: [(&str, &str); 5] =
    [("tags", "list"), ("authors", "list"), ("date", "date"), ("status", "text"), ("title", "text")];

/// Every property name the workspace's notes use, most used first, then a few common ones.
pub fn suggest_properties(workspace: &Path) -> Vec<KnownProperty> {
    #[derive(Default)]
    struct Tally {
        notes: usize,
        kinds: Vec<(String, usize)>,
        values: Vec<(String, usize)>,
    }
    fn bump(counts: &mut Vec<(String, usize)>, item: &str) {
        match counts.iter_mut().find(|(seen, _)| seen == item) {
            Some((_, count)) => *count += 1,
            None => counts.push((item.to_string(), 1)),
        }
    }
    // Most used first; ties keep the order they were first seen in.
    fn by_use(mut counts: Vec<(String, usize)>) -> Vec<String> {
        counts.sort_by(|a, b| b.1.cmp(&a.1));
        counts.into_iter().map(|(item, _)| item).collect()
    }

    let mut order: Vec<String> = vec![];
    let mut tallies: HashMap<String, Tally> = HashMap::new();
    for (path, format) in notes_in(workspace) {
        let Ok(text) = std::fs::read_to_string(workspace.join(&path)) else { continue };
        let Some(range) = find_block(&text, format) else { continue };
        let Ok(properties) = parse_block(&text[range], format) else { continue };
        for property in properties {
            if !tallies.contains_key(&property.key) {
                order.push(property.key.clone());
            }
            let tally = tallies.entry(property.key).or_default();
            tally.notes += 1;
            let kind = match &property.value {
                Value::Text(_) => "text",
                Value::Number(_) => "number",
                Value::Bool(_) => "boolean",
                Value::Date(_) => "date",
                Value::List(_) => "list",
                Value::Other => continue,
            };
            bump(&mut tally.kinds, kind);
            match &property.value {
                Value::Text(text) if !text.trim().is_empty() => bump(&mut tally.values, text),
                Value::List(items) => items.iter().for_each(|item| bump(&mut tally.values, item)),
                _ => {}
            }
        }
    }

    let mut known: Vec<KnownProperty> = order
        .into_iter()
        .map(|key| {
            let tally = tallies.remove(&key).unwrap();
            KnownProperty {
                kind: by_use(tally.kinds).into_iter().next().unwrap_or_else(|| "text".into()),
                notes: tally.notes,
                values: by_use(tally.values),
                key,
            }
        })
        .collect();
    known.sort_by(|a, b| b.notes.cmp(&a.notes));
    for (key, kind) in COMMON {
        if !known.iter().any(|p| p.key == key) {
            known.push(KnownProperty { key: key.into(), kind: kind.into(), notes: 0, values: vec![] });
        }
    }
    known
}

/// Every Markdown and Typst note in the workspace (not in hidden folders), with its format.
fn notes_in(workspace: &Path) -> Vec<(String, NoteFormat)> {
    fn walk(entries: Vec<FileEntry>, notes: &mut Vec<(String, NoteFormat)>) {
        for entry in entries {
            match entry.kind {
                EntryKind::Folder => walk(entry.children, notes),
                EntryKind::File => {
                    let format = match entry.path.rsplit('.').next() {
                        Some("md") => NoteFormat::Markdown,
                        Some("typ") => NoteFormat::Typst,
                        _ => continue,
                    };
                    notes.push((entry.path, format));
                }
            }
        }
    }
    let mut notes = vec![];
    walk(list_files(workspace).unwrap_or_default(), &mut notes);
    notes
}
