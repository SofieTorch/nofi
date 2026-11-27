//! The explorer's file actions on folders, and moving or copying files and folders (see
//! tests/folders.rs). Paths are relative to the workspace, "" being its top. A PDF's annotations
//! always go with it. Nothing outside the workspace, or in its hidden folders, is ever touched.

use crate::files::annotations_of;
use crate::notes::{inside, RenameError};
use serde::{Serialize, Serializer};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub enum FileError {
    /// Something with this name is already where it would go.
    Taken(String),
    /// A folder can't go inside itself.
    IntoItself,
    NotFound,
    Io(String),
}

impl fmt::Display for FileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Taken(name) => write!(f, "There's already something called \"{name}\" there."),
            Self::IntoItself => write!(f, "A folder can't go inside itself."),
            Self::NotFound => write!(f, "It isn't there anymore."),
            Self::Io(reason) => write!(f, "{reason}"),
        }
    }
}

/// Sent to the frontend as a readable message.
impl Serialize for FileError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::NotFound,
            _ => Self::Io(error.to_string()),
        }
    }
}

/// A path in the workspace that the user can act on: inside it, and not hidden.
fn visible(workspace: &Path, path: &str) -> Option<PathBuf> {
    if path.split('/').any(|part| part.starts_with('.')) {
        return None;
    }
    inside(workspace, path)
}

/// A folder of the workspace ("" for its top).
fn folder_at(workspace: &Path, folder: &str) -> Result<PathBuf, FileError> {
    let place = if folder.is_empty() { Some(workspace.to_path_buf()) } else { visible(workspace, folder) };
    place.filter(|p| p.is_dir()).ok_or(FileError::NotFound)
}

fn join(folder: &str, name: &str) -> String {
    if folder.is_empty() { name.to_string() } else { format!("{folder}/{name}") }
}

fn name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

/// Creates an empty folder, "New folder" (or "New folder 2"…), in a folder; returns its path.
pub fn create_folder(workspace: &Path, parent: &str) -> Result<String, FileError> {
    let place = folder_at(workspace, parent)?;
    for number in 1.. {
        let name = if number == 1 { "New folder".to_string() } else { format!("New folder {number}") };
        match fs::create_dir(place.join(&name)) {
            Ok(()) => return Ok(join(parent, &name)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    unreachable!("there is always a free number")
}

/// Gives a folder a new name, in the same parent folder; returns its new path.
pub fn rename_folder(workspace: &Path, folder: &str, new_name: &str) -> Result<String, RenameError> {
    let old = visible(workspace, folder).filter(|p| p.is_dir()).ok_or(RenameError::NotFound)?;
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
    let new_path = join(parent_of(folder), name);
    if name == name_of(folder) {
        return Ok(folder.to_string());
    }
    // On case-insensitive disks (macOS) "papers" and "Papers" are the same folder: that's fine.
    let only_capitalisation = name.to_lowercase() == name_of(folder).to_lowercase();
    if !only_capitalisation && workspace.join(&new_path).exists() {
        return Err(RenameError::Taken(name.to_string()));
    }
    fs::rename(&old, workspace.join(&new_path)).map_err(|e| RenameError::Io(e.to_string()))?;
    Ok(new_path)
}

/// A folder's rename problem, said of a folder rather than a note.
pub fn folder_rename_message(error: &RenameError) -> String {
    match error {
        RenameError::Empty => "A folder needs a name.".into(),
        RenameError::HasSlash => "A folder's name can't contain / or \\.".into(),
        RenameError::Hidden => "A folder's name can't start with a dot.".into(),
        RenameError::Taken(name) => format!("There's already something called \"{name}\" there."),
        RenameError::NotFound => "This folder isn't there anymore.".into(),
        RenameError::Io(reason) => reason.clone(),
    }
}

/// How many files are in a folder, in all its folders (a PDF's annotations aren't counted).
pub fn files_in(workspace: &Path, folder: &str) -> Result<usize, FileError> {
    fn count(path: &Path) -> io::Result<usize> {
        let mut total = 0;
        for item in fs::read_dir(path)? {
            let item = item?;
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.ends_with(crate::files::ANNOTATIONS_SUFFIX) {
                continue;
            }
            total += if item.path().is_dir() { count(&item.path())? } else { 1 };
        }
        Ok(total)
    }
    let path = visible(workspace, folder).filter(|p| p.is_dir()).ok_or(FileError::NotFound)?;
    Ok(count(&path)?)
}

/// Deletes a folder and everything in it by handing it to `remove` (the app sends it to the
/// system's Trash). Never the workspace itself.
pub fn delete_folder_with(workspace: &Path, folder: &str, remove: impl FnOnce(&Path) -> io::Result<()>) -> Result<(), FileError> {
    let path = visible(workspace, folder).filter(|p| p.is_dir()).ok_or(FileError::NotFound)?;
    remove(&path)?;
    Ok(())
}

/// Checks a file or folder can go into a folder; returns where both are.
fn source_and_place(workspace: &Path, path: &str, folder: &str) -> Result<(PathBuf, PathBuf), FileError> {
    let from = visible(workspace, path).filter(|p| p.exists()).ok_or(FileError::NotFound)?;
    let place = folder_at(workspace, folder)?;
    if folder == path || folder.starts_with(&format!("{path}/")) {
        return Err(FileError::IntoItself);
    }
    Ok((from, place))
}

/// Moves a file or folder (with what's in it) into a folder; returns its new path.
pub fn move_into(workspace: &Path, path: &str, folder: &str) -> Result<String, FileError> {
    let (from, place) = source_and_place(workspace, path, folder)?;
    if parent_of(path) == folder {
        return Ok(path.to_string());
    }
    let name = name_of(path);
    let to = place.join(name);
    let annotations = annotations_of(path).map(|a| (workspace.join(&a), place.join(name_of(&a))));
    if to.exists() || annotations.as_ref().is_some_and(|(old, new)| old.exists() && new.exists()) {
        return Err(FileError::Taken(name.to_string()));
    }
    fs::rename(&from, &to)?;
    if let Some((old, new)) = annotations.filter(|(old, _)| old.is_file()) {
        fs::rename(old, new)?;
    }
    Ok(join(folder, name))
}

/// Copies a file or folder (with what's in it) into a folder: named as it is, or with "copy"
/// after its name if that's taken ("Ideas copy.typ", then "Ideas copy 2.typ"). Returns its path.
pub fn copy_into(workspace: &Path, path: &str, folder: &str) -> Result<String, FileError> {
    let (from, place) = source_and_place(workspace, path, folder)?;
    let name = name_of(path);
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if from.is_file() && !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    let annotations = annotations_of(path).map(|a| workspace.join(a)).filter(|a| a.is_file());
    for number in 1.. {
        let new_name = match number {
            1 => name.to_string(),
            2 => format!("{stem} copy{extension}"),
            n => format!("{stem} copy {}{extension}", n - 1),
        };
        let new_path = join(folder, &new_name);
        let new_annotations = annotations.as_ref().and_then(|_| annotations_of(&new_path)).map(|a| workspace.join(a));
        if place.join(&new_name).exists() || new_annotations.as_ref().is_some_and(|a| a.exists()) {
            continue;
        }
        copy_all(&from, &place.join(&new_name))?;
        if let (Some(old), Some(new)) = (&annotations, &new_annotations) {
            fs::copy(old, new)?;
        }
        return Ok(new_path);
    }
    unreachable!("there is always a free number")
}

fn copy_all(from: &Path, to: &Path) -> io::Result<()> {
    if from.is_dir() {
        fs::create_dir(to)?;
        for item in fs::read_dir(from)? {
            let item = item?;
            copy_all(&item.path(), &to.join(item.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ())
    }
}
