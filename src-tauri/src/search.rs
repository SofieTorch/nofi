//! Searching the text inside the workspace's notes (Typst and Markdown files).

use crate::files::{list_files, EntryKind, FileEntry};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// More than this many matches isn't useful in a list: typing more narrows it down.
pub const MAX_MATCHES: usize = 100;

/// Characters of a line shown before and after the match, when the line is long.
const AROUND: usize = 40;

/// A line of a note with the text that was looked for.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMatch {
    /// The note, relative to the workspace.
    pub path: String,
    /// The line, from 1.
    pub line: usize,
    /// Where the match starts in its line, counted like the editor (in UTF-16 units).
    pub column: usize,
    /// How long the match is (in UTF-16 units).
    pub length: usize,
    /// The line to show: without its indentation, and shortened around the match if long.
    pub preview: String,
    /// Where the match starts in the preview (in characters).
    pub preview_column: usize,
}

pub fn search_notes(workspace: &Path, query: &str) -> Vec<TextMatch> {
    let wanted: Vec<char> = query.trim().chars().flat_map(char::to_lowercase).collect();
    if wanted.is_empty() {
        return vec![];
    }
    let mut notes = vec![];
    collect_notes(&list_files(workspace).unwrap_or_default(), &mut notes);

    let mut matches = vec![];
    for path in notes {
        let Ok(text) = fs::read_to_string(workspace.join(&path)) else { continue };
        for (index, line) in text.lines().enumerate() {
            if let Some(found) = match_in(line, &wanted) {
                matches.push(text_match(&path, index + 1, line, found, wanted.len()));
                if matches.len() == MAX_MATCHES {
                    return matches;
                }
            }
        }
    }
    matches
}

fn collect_notes(entries: &[FileEntry], notes: &mut Vec<String>) {
    // Notes in the workspace's top folder first, then those in folders (like the explorer, flat).
    for entry in entries.iter().filter(|e| e.kind == EntryKind::File) {
        if entry.path.ends_with(".typ") || entry.path.ends_with(".md") {
            notes.push(entry.path.clone());
        }
    }
    for entry in entries.iter().filter(|e| e.kind == EntryKind::Folder) {
        collect_notes(&entry.children, notes);
    }
}

/// Where (in characters) the first match in a line starts, ignoring case.
fn match_in(line: &str, wanted: &[char]) -> Option<usize> {
    let chars: Vec<char> = line.chars().collect();
    (0..chars.len()).find(|&start| {
        let mut lowered = chars[start..].iter().flat_map(|c| c.to_lowercase());
        wanted.iter().all(|w| lowered.next() == Some(*w))
    })
}

fn text_match(path: &str, line_number: usize, line: &str, start: usize, wanted: usize) -> TextMatch {
    let chars: Vec<char> = line.chars().collect();
    // (Lowercasing can change the length, e.g. "İ"; the match is at least one character.)
    let end = (start + wanted).min(chars.len()).max(start + 1).min(chars.len());
    let utf16 = |slice: &[char]| slice.iter().map(|c| c.len_utf16()).sum::<usize>();

    let indent = chars.iter().take_while(|c| c.is_whitespace()).count().min(start);
    let from = indent.max(start.saturating_sub(AROUND));
    let to = chars.len().min(end + AROUND);
    let mut preview = String::new();
    if from > indent {
        preview.push('…');
    }
    preview.extend(&chars[from..to]);
    if to < chars.len() {
        preview.push('…');
    }
    TextMatch {
        path: path.to_string(),
        line: line_number,
        column: utf16(&chars[..start]),
        length: utf16(&chars[start..end]),
        preview,
        preview_column: start - from + usize::from(from > indent),
    }
}
