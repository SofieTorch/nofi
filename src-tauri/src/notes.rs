//! Creating and renaming notes. A note is a plain file in the workspace, written in Typst or Markdown.

use serde::{Deserialize, Serialize, Serializer};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Component, Path};

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

#[derive(Debug, PartialEq)]
pub enum RenameError {
    Empty,
    HasSlash,
    /// Names starting with a dot are hidden, so the note would vanish from the explorer.
    Hidden,
    /// Another note (in any format) already uses this name.
    Taken(String),
    NotFound,
    Io(String),
}

impl fmt::Display for RenameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => write!(f, "A note needs a name."),
            Self::HasSlash => write!(f, "A note's name can't contain / or \\."),
            Self::Hidden => write!(f, "A note's name can't start with a dot."),
            Self::Taken(name) => write!(f, "There's already a note called \"{name}\"."),
            Self::NotFound => write!(f, "This note doesn't exist anymore."),
            Self::Io(reason) => write!(f, "{reason}"),
        }
    }
}

/// Sent to the frontend as a readable message.
impl Serialize for RenameError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Gives a note a new name, keeping its format and folder. `note` is its path relative to the
/// workspace; `new_name` is what the user typed, without extension. Returns the new relative path.
pub fn rename_note(workspace: &Path, note: &str, new_name: &str) -> Result<String, RenameError> {
    let relative = Path::new(note);
    // Only plain names: no "..", so nothing outside the workspace can be touched.
    if !relative.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(RenameError::NotFound);
    }
    let old = workspace.join(relative);
    if !old.is_file() {
        return Err(RenameError::NotFound);
    }

    let name = new_name.trim();
    if name.is_empty() {
        return Err(RenameError::Empty);
    }
    if name.contains(['/', '\\']) {
        return Err(RenameError::HasSlash);
    }
    if name.starts_with('.') {
        return Err(RenameError::Hidden);
    }

    let old_name = relative.file_stem().unwrap_or_default().to_string_lossy();
    let extension = relative.extension().map(|e| e.to_string_lossy().into_owned());
    let file_name = match &extension {
        Some(extension) => format!("{name}.{extension}"),
        None => name.to_string(),
    };
    let new_path = match note.rsplit_once('/') {
        Some((folder, _)) => format!("{folder}/{file_name}"),
        None => file_name,
    };
    if name == old_name {
        return Ok(note.to_string());
    }

    // On case-insensitive disks (macOS) "ideas" and "Ideas" are the same file: renaming it is fine.
    let only_capitalisation = name.to_lowercase() == old_name.to_lowercase();
    let folder = old.parent().unwrap_or(workspace);
    let taken = ALL_FORMATS
        .iter()
        .map(|f| f.extension().to_string())
        .chain(extension.clone())
        .any(|ext| {
            let same_file = only_capitalisation && Some(&ext) == extension.as_ref();
            !same_file && folder.join(format!("{name}.{ext}")).exists()
        });
    if taken {
        return Err(RenameError::Taken(name.to_string()));
    }

    fs::rename(&old, workspace.join(&new_path)).map_err(|e| RenameError::Io(e.to_string()))?;
    Ok(new_path)
}
