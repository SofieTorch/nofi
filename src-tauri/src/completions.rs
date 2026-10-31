//! Suggestions while writing Typst, from Typst's own editor helpers: what a function can be set
//! to, valid values, fonts, symbols in maths… Positions are in UTF-16 code units, like the editor.

use crate::typst_world::NoteWorld;
use serde::Serialize;
use typst_ide::{autocomplete, CompletionKind};
use typst_layout::PagedDocument;

#[derive(Debug, Serialize)]
pub struct Suggestions {
    /// Where the text the suggestions replace starts (it ends at the cursor).
    pub from: usize,
    pub items: Vec<Suggestion>,
}

#[derive(Debug, Serialize)]
pub struct Suggestion {
    pub label: String,
    /// "function", "parameter", "constant", "font", "symbol"…
    pub kind: String,
    /// The symbol itself, for maths symbols (like "α").
    pub symbol: Option<String>,
    /// A short description, at most one sentence.
    pub detail: Option<String>,
    /// What to insert.
    pub insert: String,
    /// Where the cursor goes in `insert`, and how much after it to select (a placeholder).
    pub cursor: usize,
    pub selection: usize,
}

/// Suggestions at the cursor. Unless `explicit` (asked for with Ctrl+Space), plain text gets none.
pub fn complete(note: &str, cursor: usize, explicit: bool) -> Option<Suggestions> {
    let world = NoteWorld::new(note.to_string());
    let source = world.source_text();
    let byte = source.lines().utf16_to_byte(cursor)?;
    let (from, completions) = autocomplete(&world, None::<&PagedDocument>, source, byte, explicit)?;
    if completions.is_empty() {
        return None;
    }
    let items = completions
        .into_iter()
        .map(|completion| {
            let (insert, cursor, selection) =
                expand_snippet(completion.apply.as_deref().unwrap_or(&completion.label));
            let (kind, symbol) = match completion.kind {
                CompletionKind::Syntax => ("syntax", None),
                CompletionKind::Func => ("function", None),
                CompletionKind::Type => ("type", None),
                CompletionKind::Param => ("parameter", None),
                CompletionKind::Constant => ("constant", None),
                CompletionKind::Path => ("path", None),
                CompletionKind::Package => ("package", None),
                CompletionKind::Label => ("label", None),
                CompletionKind::Font => ("font", None),
                CompletionKind::Symbol(symbol) => ("symbol", Some(symbol.to_string())),
            };
            Suggestion {
                label: completion.label.to_string(),
                kind: kind.into(),
                symbol,
                // Typst's descriptions can contain line breaks: keep them to one line.
                detail: completion.detail.map(|d| d.split_whitespace().collect::<Vec<_>>().join(" ")),
                insert,
                cursor,
                selection,
            }
        })
        .collect();
    Some(Suggestions { from: source.lines().byte_to_utf16(from)?, items })
}

/// Turns Typst's snippet syntax (`let ${name} = ${value}`) into plain text, with the cursor at the
/// first placeholder and its name selected, so typing replaces it.
pub(crate) fn expand_snippet(snippet: &str) -> (String, usize, usize) {
    let mut text = String::new();
    let mut first: Option<(usize, usize)> = None;
    let mut rest = snippet;
    while let Some(start) = rest.find("${") {
        let Some(end) = rest[start..].find('}') else { break };
        text.push_str(&rest[..start]);
        let name = &rest[start + 2..start + end];
        let at = text.encode_utf16().count();
        first.get_or_insert((at, name.encode_utf16().count()));
        text.push_str(name);
        rest = &rest[start + end + 1..];
    }
    text.push_str(rest);
    let (cursor, selection) = first.unwrap_or((text.encode_utf16().count(), 0));
    (text, cursor, selection)
}
