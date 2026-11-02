//! The links between the workspace's notes, for the graph view. A link is a plain link to a note's
//! file, written from the linking note's folder: `#link("Ideas.md")[…]` in Typst, `[…](Ideas.md)`
//! in Markdown (spaces written as %20).

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
        let markdown = note.ends_with(".md");
        for address in addresses(&without_code(&text), markdown) {
            if let Some(target) = resolve(&note, &address, markdown) {
                if target != note {
                    found.insert((note.clone(), target));
                }
            }
        }
    }
    found.into_iter().map(|(from, to)| NoteLink { from, to }).collect()
}

fn collect_notes(entries: &[FileEntry], notes: &mut Vec<String>) {
    for entry in entries {
        match entry.kind {
            EntryKind::Folder => collect_notes(&entry.children, notes),
            EntryKind::File if is_note(&entry.path) => notes.push(entry.path.clone()),
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

/// The note an address points to, as a workspace path; None for a website, a file that isn't a
/// note, a place in the same note, or somewhere outside the workspace.
fn resolve(from: &str, address: &str, markdown: bool) -> Option<String> {
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
    is_note(&path).then_some(path)
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
