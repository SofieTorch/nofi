//! Lists what's inside a workspace, for the file explorer.

use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::io;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FileEntry {
    pub name: String,
    /// Relative to the workspace folder, always with `/` separators.
    pub path: String,
    pub kind: EntryKind,
    pub children: Vec<FileEntry>,
}

pub fn list_files(workspace: &Path) -> io::Result<Vec<FileEntry>> {
    list_folder(workspace, "")
}

fn list_folder(folder: &Path, relative: &str) -> io::Result<Vec<FileEntry>> {
    let mut entries = vec![];
    for item in fs::read_dir(folder)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        // Hidden files, including the app's own `.marginalia` folder.
        if name.starts_with('.') {
            continue;
        }
        let path = if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
        let entry = if item.file_type()?.is_dir() || item.path().is_dir() {
            let children = list_folder(&item.path(), &path)?;
            FileEntry { name, path, kind: EntryKind::Folder, children }
        } else {
            FileEntry { name, path, kind: EntryKind::File, children: vec![] }
        };
        entries.push(entry);
    }
    entries.sort_by(|a, b| {
        let folders_first = (b.kind == EntryKind::Folder).cmp(&(a.kind == EntryKind::Folder));
        folders_first.then_with(|| natural_cmp(&a.name, &b.name))
    });
    Ok(entries)
}

/// Compares names the way people expect: ignoring case, and "2" before "10".
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a_chars, mut b_chars) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a_chars.peek(), b_chars.peek()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let a_num = take_number(&mut a_chars);
                let b_num = take_number(&mut b_chars);
                let order = a_num.len().cmp(&b_num.len()).then_with(|| a_num.cmp(&b_num));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(&x), Some(&y)) => {
                let order = x.to_lowercase().cmp(y.to_lowercase());
                if order != Ordering::Equal {
                    return order;
                }
                a_chars.next();
                b_chars.next();
            }
        }
    }
}

/// Digits without leading zeros, so their length orders them by value.
fn take_number(chars: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut digits = String::new();
    while let Some(c) = chars.peek().filter(|c| c.is_ascii_digit()) {
        digits.push(*c);
        chars.next();
    }
    let trimmed = digits.trim_start_matches('0');
    if trimmed.is_empty() { "0".into() } else { trimmed.into() }
}
