//! Creating notes. A note is a plain file in the workspace, written in Typst or Markdown.

use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io;
use std::path::Path;

const ALL_FORMATS: [NoteFormat; 2] = [NoteFormat::Typst, NoteFormat::Markdown];

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteFormat {
    /// The default: good for research notes thanks to its maths, citations and layout.
    #[default]
    Typst,
    Markdown,
}

impl NoteFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Typst => "typ",
            Self::Markdown => "md",
        }
    }
}

/// Creates an empty note at the top of the workspace and returns its path relative to the workspace.
pub fn create_note(workspace: &Path, format: NoteFormat) -> io::Result<String> {
    for number in 1.. {
        let name = if number == 1 { "Untitled".to_string() } else { format!("Untitled {number}") };
        // A name is taken if a note in any format already uses it.
        if ALL_FORMATS.iter().any(|f| workspace.join(format!("{name}.{}", f.extension())).exists()) {
            continue;
        }
        let file_name = format!("{name}.{}", format.extension());
        // `create_new` fails instead of overwriting if the file appeared in the meantime.
        match OpenOptions::new().write(true).create_new(true).open(workspace.join(&file_name)) {
            Ok(_) => return Ok(file_name),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    unreachable!("there is always a free number")
}
