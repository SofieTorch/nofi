//! Finding the mistakes in a Typst note while it's written, explaining them plainly, and offering
//! fixes. The common accidents of normal writing (`$5`, `user@mail.com`, `2 * 3`, `C#`) each get
//! a message that says what happened and a fix that keeps what the writer meant.
//! Positions are counted in UTF-16 code units, like the editor counts characters.

use crate::completions::complete;
use crate::typst_world::{readable, NoteWorld};
use serde::Serialize;
use std::ops::Range;
use typst::diag::{Severity, SourceDiagnostic};
use typst::WorldExt;
use typst_layout::PagedDocument;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Problem {
    pub from: usize,
    pub to: usize,
    /// "error" (the note can't be drawn) or "warning" (it can, but something is off).
    pub severity: String,
    pub message: String,
    pub hints: Vec<String>,
    pub fixes: Vec<Fix>,
}

/// Replacing `from..to` with `insert` fixes the problem.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Fix {
    pub label: String,
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

/// Every problem Typst finds in the note, errors first. Only fixes that really help are offered:
/// each one is tried, and kept if nothing is wrong anymore from the mistake to the end of the fix.
/// (Mistakes further on that the fix uncovers don't count: an unclosed `$` hides everything after it.)
pub fn check_note(note: &str) -> Vec<Problem> {
    check_with(note, &|text: &str| NoteWorld::new(text.to_string()))
}

/// Like `check_note`, for a note in a workspace (path relative to its folder): it can use the
/// workspace's files, like images.
pub fn check_note_at(note: &str, workspace: &std::path::Path, path: &str) -> Vec<Problem> {
    check_with(note, &|text: &str| NoteWorld::at(text.to_string(), workspace, path))
}

fn check_with(note: &str, world_of: &dyn Fn(&str) -> NoteWorld) -> Vec<Problem> {
    let (errors, warnings) = diagnose(note, world_of);
    let world = world_of(note);
    errors
        .iter()
        .chain(warnings.iter())
        .map(|diagnostic| {
            let mut problem = problem(note, &world, diagnostic);
            if problem.severity == "error" {
                let (from, to) = (problem.from, problem.to);
                problem.fixes.retain(|fix| helps(note, from, to, fix, world_of));
            }
            problem
        })
        .collect()
}

fn helps(note: &str, from: usize, to: usize, fix: &Fix, world_of: &dyn Fn(&str) -> NoteWorld) -> bool {
    let fixed = apply(note, fix);
    let grown = fix.insert.encode_utf16().count() as isize - (fix.to - fix.from) as isize;
    let shifted = |at: usize| if at >= fix.to { (at as isize + grown) as usize } else { at };
    let start = from.min(fix.from);
    let end = shifted(to).max(fix.from + fix.insert.encode_utf16().count());
    let world = world_of(&fixed);
    diagnose(&fixed, world_of).0.iter().all(|error| {
        let Some(range) = world.range(error.span) else { return true };
        let error_from = fixed[..range.start].encode_utf16().count();
        let error_to = fixed[..range.end].encode_utf16().count();
        error_to < start || error_from > end
    })
}

fn diagnose(note: &str, world_of: &dyn Fn(&str) -> NoteWorld) -> (Vec<SourceDiagnostic>, Vec<SourceDiagnostic>) {
    let world = world_of(note);
    let result = typst::compile::<PagedDocument>(&world);
    let errors = result.output.err().map(|errors| errors.to_vec()).unwrap_or_default();
    (errors, result.warnings.to_vec())
}

fn apply(note: &str, fix: &Fix) -> String {
    let units: Vec<u16> = note.encode_utf16().collect();
    let before = String::from_utf16_lossy(&units[..fix.from]);
    let after = String::from_utf16_lossy(&units[fix.to..]);
    format!("{before}{}{after}", fix.insert)
}

fn problem(note: &str, world: &NoteWorld, diagnostic: &SourceDiagnostic) -> Problem {
    let range = world.range(diagnostic.span).unwrap_or(0..0);
    let text = &note[range.clone()];
    let first = text.chars().next();
    let utf16 = |byte: usize| note[..byte].encode_utf16().count();
    let message = diagnostic.message.as_str();
    let mut fixes = vec![];
    let hints: Vec<String> = diagnostic.hints.iter().map(|hint| hint.v.to_string()).collect();

    let explanation = match (message, first) {
        ("unclosed delimiter", Some(opening @ ('$' | '*' | '_'))) => {
            let (what, closing_label) = match opening {
                '$' => ("maths", "Close the maths"),
                '*' => ("bold text", "Close the bold text"),
                _ => ("italic text", "Close the italic text"),
            };
            fixes.push(escape(note, range.start, opening));
            fixes.push(close_at_line_end(note, range.start, closing_label, opening));
            Some(format!("This {opening} starts {what}, but the {what} never ends."))
        }
        ("unclosed delimiter", Some(opening @ ('(' | '[' | '{'))) => {
            let closing = match opening {
                '(' => ')',
                '[' => ']',
                _ => '}',
            };
            fixes.push(close_at_line_end(note, range.start, "Close it", closing));
            Some(format!("This {opening} is never closed."))
        }
        ("unclosed raw text", Some('`')) => {
            fixes.push(escape(note, range.start, '`'));
            fixes.push(close_at_line_end(note, range.start, "Close the code", '`'));
            Some("This ` starts code, but the code never ends.".into())
        }
        ("expected expression", _) if note[..range.start].ends_with('#') => {
            fixes.push(escape(note, range.start - 1, '#'));
            Some("# starts Typst code, but no code follows it.".into())
        }
        (message, Some('@')) if message.starts_with("label `<") && message.ends_with("does not exist in the document") => {
            fixes.push(escape(note, range.start, '@'));
            Some(format!("@ refers to a label, but this note has no <{}> label.", &text[1..]))
        }
        (message, _) if message.starts_with("unknown variable: ") => {
            fixes.extend(closest_names(note, range.clone(), text));
            fixes.extend(suggestions_in_hints(note, range.clone(), &hints));
            None
        }
        _ => None,
    };

    Problem {
        from: utf16(range.start),
        to: utf16(range.end),
        severity: match diagnostic.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        }
        .into(),
        message: explanation.unwrap_or_else(|| readable(message)),
        hints: hints.iter().map(|hint| readable(hint)).collect(),
        fixes,
    }
}

/// Puts a backslash before a character, so Typst shows it as it is.
fn escape(note: &str, at: usize, character: char) -> Fix {
    let at = note[..at].encode_utf16().count();
    Fix { label: format!("Write {character} as text"), from: at, to: at, insert: "\\".into() }
}

/// Adds the closing character at the end of the line the opening one is on.
fn close_at_line_end(note: &str, opening: usize, label: &str, closing: char) -> Fix {
    let line_end = note[opening..].find('\n').map_or(note.len(), |n| opening + n);
    let end = opening + note[opening..line_end].trim_end().len();
    let at = note[..end].encode_utf16().count();
    Fix { label: label.into(), from: at, to: at, insert: closing.to_string() }
}

/// "Did you mean…": the names Typst knows at that spot that are spelled almost the same.
fn closest_names(note: &str, range: Range<usize>, typed: &str) -> Vec<Fix> {
    let from = note[..range.start].encode_utf16().count();
    let to = note[..range.end].encode_utf16().count();
    let Some(suggestions) = complete(note, to, true) else { return vec![] };
    let mut close: Vec<(usize, String)> = suggestions
        .items
        .into_iter()
        .filter(|item| !item.label.contains(' ') && item.label != typed)
        .map(|item| (distance(&item.label, typed), item.label))
        .filter(|(d, label)| *d <= 2 && *d < label.chars().count())
        .collect();
    close.sort();
    close.dedup_by(|a, b| a.1 == b.1);
    close
        .into_iter()
        .take(3)
        .map(|(_, name)| Fix { label: format!("Use {name}"), from, to, insert: name })
        .collect()
}

/// Typst's hints often end with a fix in backticks, like "try adding spaces: `a l p a h`".
fn suggestions_in_hints(note: &str, range: Range<usize>, hints: &[String]) -> Vec<Fix> {
    let from = note[..range.start].encode_utf16().count();
    let to = note[..range.end].encode_utf16().count();
    hints
        .iter()
        .filter_map(|hint| {
            let start = hint.rfind(": `")? + 3;
            let replacement = hint[start..].strip_suffix('`')?;
            Some(Fix { label: format!("Use {replacement}"), from, to, insert: replacement.into() })
        })
        .collect()
}

/// How many single-letter edits turn one word into the other.
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut current = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(ca != cb);
            current.push(substitution.min(previous[j + 1] + 1).min(current[j] + 1));
        }
        previous = current;
    }
    previous[b.len()]
}
