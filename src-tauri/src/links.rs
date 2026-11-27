//! The links between the workspace's notes, for the graph view. A link is a plain link to a note's
//! file, written from the linking note's folder: `#link("Ideas.md")[…]` in Typst, `[…](Ideas.md)`
//! in Markdown (spaces written as %20). A note's `source` property (the file it's about, like a
//! PDF its notes are on) is a link too. A board (`.canvas`) links to the notes on it, and to those
//! its text cards link to.

use crate::files::{list_files, EntryKind, FileEntry};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NoteLink {
    /// The note the link is in, and the note it points to (which may not exist yet).
    pub from: String,
    pub to: String,
}

pub fn note_links(workspace: &Path) -> Vec<NoteLink> {
    let mut notes = vec![];
    collect_notes(&list_files(workspace).unwrap_or_default(), &mut notes);
    let mut found = BTreeSet::new();
    for note in notes {
        let Ok(text) = fs::read_to_string(workspace.join(&note)) else { continue };
        if note.ends_with(".canvas") {
            for target in board_links(&note, &text) {
                found.insert((note.clone(), target));
            }
            continue;
        }
        let markdown = note.ends_with(".md");
        for address in links_in(&text, markdown) {
            if let Some(target) = resolve(&note, &address, markdown) {
                if target != note {
                    found.insert((note.clone(), target));
                }
            }
        }
    }
    found.into_iter().map(|(from, to)| NoteLink { from, to }).collect()
}

/// A board's links: the notes shown as cards (paths from the workspace), and the links written in
/// its text cards (Typst, from the board's folder).
fn board_links(board: &str, text: &str) -> Vec<String> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else { return vec![] };
    let mut found = vec![];
    for node in json["nodes"].as_array().into_iter().flatten() {
        match node["type"].as_str() {
            Some("file") => {
                if let Some(file) = node["file"].as_str().filter(|file| is_note(file)) {
                    found.push(file.to_string());
                }
            }
            Some("text") => {
                let text = node["text"].as_str().unwrap_or("");
                found.extend(addresses(&without_code(text), false).iter().filter_map(|a| resolve(board, a, false)));
            }
            _ => {}
        }
    }
    found
}

fn collect_notes(entries: &[FileEntry], notes: &mut Vec<String>) {
    for entry in entries {
        match entry.kind {
            EntryKind::Folder => collect_notes(&entry.children, notes),
            EntryKind::File if is_note(&entry.path) || entry.path.ends_with(".canvas") => notes.push(entry.path.clone()),
            EntryKind::File => {}
        }
    }
}

fn is_note(path: &str) -> bool {
    path.ends_with(".typ") || path.ends_with(".md")
}

/// The text without its fenced code blocks (links shown as code aren't links).
fn without_code(text: &str) -> String {
    let mut inside = false;
    let mut kept = String::new();
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            inside = !inside;
            continue;
        }
        if !inside {
            kept.push_str(line);
            kept.push('\n');
        }
    }
    kept
}

/// The addresses of the links written in a note.
/// The addresses a note links to: its links, and its `source` property.
fn links_in(text: &str, markdown: bool) -> Vec<String> {
    let mut found = addresses(&without_code(text), markdown);
    found.extend(source_of(text, markdown));
    found
}

/// What a note's `source` property names, if it has one (written as a path, like a link's address).
fn source_of(text: &str, markdown: bool) -> Option<String> {
    use crate::notes::NoteFormat;
    use crate::properties::{find_block, parse_block, Value};
    let format = if markdown { NoteFormat::Markdown } else { NoteFormat::Typst };
    let block = find_block(text, format)?;
    let properties = parse_block(&text[block], format).ok()?;
    match properties.into_iter().find(|p| p.key == "source")?.value {
        Value::Text(source) if !source.trim().is_empty() => Some(source.trim().to_string()),
        _ => None,
    }
}

fn addresses(text: &str, markdown: bool) -> Vec<String> {
    let mut found = vec![];
    if markdown {
        // [text](address): the address has no spaces.
        let mut rest = text;
        while let Some(at) = rest.find("](") {
            let after = &rest[at + 2..];
            if let Some(end) = after.find(|c: char| c == ')' || c.is_whitespace()) {
                if after[end..].starts_with(')') {
                    found.push(after[..end].to_string());
                }
            }
            rest = after;
        }
    } else {
        // #link("address"): a quoted address, maybe with escaped quotes.
        let mut rest = text;
        while let Some(at) = rest.find("#link(") {
            let after = rest[at + 6..].trim_start();
            if let Some(quoted) = after.strip_prefix('"') {
                let mut address = String::new();
                let mut chars = quoted.chars();
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => address.extend(chars.next()),
                        '"' => {
                            found.push(address.clone());
                            break;
                        }
                        _ => address.push(c),
                    }
                }
            }
            rest = &rest[at + 6..];
        }
    }
    found
}

/// The notes that link to a file (any file, like a PDF), maybe to a part of it.
pub fn notes_linking_to(workspace: &Path, file: &str) -> Vec<String> {
    let mut notes = vec![];
    collect_notes(&list_files(workspace).unwrap_or_default(), &mut notes);
    notes
        .into_iter()
        .filter(|note| is_note(note) && note != file)
        .filter(|note| {
            let Ok(text) = fs::read_to_string(workspace.join(note)) else { return false };
            let markdown = note.ends_with(".md");
            links_in(&text, markdown)
                .iter()
                .any(|address| resolve_file(note, address, markdown).as_deref() == Some(file))
        })
        .collect()
}

/// The note an address points to, as a workspace path; None for a website, a file that isn't a
/// note, a place in the same note, or somewhere outside the workspace.
fn resolve(from: &str, address: &str, markdown: bool) -> Option<String> {
    resolve_file(from, address, markdown).filter(|path| is_note(path))
}

/// The file an address points to, as a workspace path (without its part, after the #).
/// A Zotero paper's address (`zotero:<id>`, maybe with a part) is the paper itself, `zotero:<id>`.
fn resolve_file(from: &str, address: &str, markdown: bool) -> Option<String> {
    if let Some(id) = address.strip_prefix("zotero:") {
        let id = id.split('#').next().unwrap_or("");
        return (!id.is_empty()).then(|| format!("zotero:{id}"));
    }
    let has_scheme = address.split_once(':').is_some_and(|(scheme, _)| {
        !scheme.is_empty() && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    });
    if has_scheme || address.starts_with('#') || address.starts_with('/') {
        return None;
    }
    let target = address.split('#').next().unwrap_or("");
    let target = if markdown { percent_decode(target)? } else { target.to_string() };
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    let path = parts.join("/");
    (!path.is_empty()).then_some(path)
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            decoded.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(decoded).ok()
}
