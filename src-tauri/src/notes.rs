//! Creating, renaming, reading and saving notes. A note is a plain file in the workspace, written in Typst or Markdown.

use serde::{Deserialize, Serialize, Serializer};
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Component, Path, PathBuf};

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

/// Creates an empty board (whiteboard) at the top of the workspace, `Untitled.canvas`, and returns
/// its path. An empty file is an empty board.
pub fn create_board(workspace: &Path) -> io::Result<String> {
    for number in 1.. {
        let name = if number == 1 { "Untitled".to_string() } else { format!("Untitled {number}") };
        let file_name = format!("{name}.canvas");
        match OpenOptions::new().write(true).create_new(true).open(workspace.join(&file_name)) {
            Ok(_) => return Ok(file_name),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    unreachable!("there is always a free number")
}

/// Creates an empty note at a path (relative to the workspace), with the folders it needs: what a
/// link to a note that doesn't exist yet points to. A note there by then is left as it is.
pub fn create_note_at(workspace: &Path, note: &str) -> Result<String, NoteError> {
    let path = inside(workspace, note).ok_or(NoteError::NotFound)?;
    if !ALL_FORMATS.iter().any(|f| note.ends_with(&format!(".{}", f.extension()))) {
        return Err(NoteError::Io(format!("\"{}\" isn't a note (.typ or .md).", file_name(note))));
    }
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => Ok(note.to_string()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists && path.is_file() => Ok(note.to_string()),
        Err(e) => Err(e.into()),
    }
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
    let old = inside(workspace, note).ok_or(RenameError::NotFound)?;
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
    // A PDF's annotations go with it, so another PDF's can't be in the way.
    let annotations = crate::files::annotations_of(note).zip(crate::files::annotations_of(&new_path));
    let taken = taken || annotations.as_ref().is_some_and(|(_, new)| !only_capitalisation && workspace.join(new).exists());
    if taken {
        return Err(RenameError::Taken(name.to_string()));
    }

    fs::rename(&old, workspace.join(&new_path)).map_err(|e| RenameError::Io(e.to_string()))?;
    if let Some((old_annotations, new_annotations)) = annotations {
        if workspace.join(&old_annotations).is_file() {
            fs::rename(workspace.join(old_annotations), workspace.join(new_annotations)).map_err(|e| RenameError::Io(e.to_string()))?;
        }
    }
    Ok(new_path)
}

/// Where a note's relative path points, or None if it would point outside the workspace.
fn inside(workspace: &Path, note: &str) -> Option<PathBuf> {
    let relative = Path::new(note);
    // Only plain names: no "..", so nothing outside the workspace can be touched.
    let plain = relative.components().all(|c| matches!(c, Component::Normal(_)));
    (plain && !note.is_empty()).then(|| workspace.join(relative))
}

#[derive(Debug, PartialEq)]
pub enum NoteError {
    NotFound,
    /// Undoing a new note only removes it while it's empty, so nothing written is lost.
    NotEmpty(String),
    AlreadyExists(String),
    Io(String),
}

impl fmt::Display for NoteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => write!(f, "This note doesn't exist anymore."),
            Self::NotEmpty(name) => write!(f, "\"{name}\" has text in it now, so it was kept."),
            Self::AlreadyExists(name) => write!(f, "There's already a note called \"{name}\"."),
            Self::Io(reason) => write!(f, "{reason}"),
        }
    }
}

/// Sent to the frontend as a readable message.
impl Serialize for NoteError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<io::Error> for NoteError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::NotFound,
            _ => Self::Io(error.to_string()),
        }
    }
}

/// What's written in a note (its path relative to the workspace).
pub fn read_note(workspace: &Path, note: &str) -> Result<String, NoteError> {
    let path = inside(workspace, note).ok_or(NoteError::NotFound)?;
    Ok(fs::read_to_string(path)?)
}

/// Replaces what's written in a note. Writes a hidden temporary file next to it and then swaps
/// it in, so a crash never leaves a half-written note. Recreates the note if it was deleted.
pub fn save_note(workspace: &Path, note: &str, contents: &str) -> Result<(), NoteError> {
    let path = inside(workspace, note).ok_or(NoteError::NotFound)?;
    let folder = path.parent().ok_or(NoteError::NotFound)?;
    let file_name = path.file_name().ok_or(NoteError::NotFound)?.to_string_lossy();
    let temporary = folder.join(format!(".{file_name}.saving"));
    fs::write(&temporary, contents)?;
    if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    Ok(())
}

fn file_name(note: &str) -> String {
    note.rsplit('/').next().unwrap_or(note).to_string()
}

/// Undoes creating a note: removes it, but only while it's still empty.
pub fn remove_empty_note(workspace: &Path, note: &str) -> Result<(), NoteError> {
    let path = inside(workspace, note).ok_or(NoteError::NotFound)?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        return Err(NoteError::NotFound);
    }
    if metadata.len() > 0 {
        return Err(NoteError::NotEmpty(file_name(note)));
    }
    Ok(fs::remove_file(path)?)
}

/// Deletes a file (any kind, not a folder) by handing it to `remove`: the app sends it to the
/// system's Trash. A PDF's annotations go with it. Never touches anything outside the workspace.
pub fn delete_file_with(
    workspace: &Path,
    file: &str,
    mut remove: impl FnMut(&Path) -> io::Result<()>,
) -> Result<(), NoteError> {
    let path = inside(workspace, file).ok_or(NoteError::NotFound)?;
    if !path.is_file() {
        return Err(NoteError::NotFound);
    }
    remove(&path)?;
    if let Some(annotations) = crate::files::annotations_of(file).and_then(|a| inside(workspace, &a)) {
        if annotations.is_file() {
            remove(&annotations)?;
        }
    }
    Ok(())
}

/// Redoes creating a note: brings it back, empty, at the same place. Never overwrites anything.
pub fn restore_empty_note(workspace: &Path, note: &str) -> Result<(), NoteError> {
    let path = inside(workspace, note).ok_or(NoteError::NotFound)?;
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            Err(NoteError::AlreadyExists(file_name(note)))
        }
        Err(e) => Err(e.into()),
    }
}
