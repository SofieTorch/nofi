//! Files in the workspace that notes use, like images: pasted images are saved in its `assets`
//! folder, and the editor and the PDF reader read workspace files through here.

use crate::notes::NoteError;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

pub const ASSETS_FOLDER: &str = "assets";
const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

/// Saves an image in the workspace's `assets` folder (made if needed) under a free name like
/// "name 2.png", and returns its path in the workspace. Only images are saved this way.
pub fn save_asset(workspace: &Path, name: &str, bytes: &[u8]) -> Result<String, NoteError> {
    let name = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("image.png");
    let path = Path::new(name);
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(NoteError::Io(format!("\"{name}\" isn't an image.")));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).filter(|s| !s.starts_with('.')).unwrap_or("image");
    let folder = workspace.join(ASSETS_FOLDER);
    fs::create_dir_all(&folder)?;
    for number in 1.. {
        let file = if number == 1 { format!("{stem}.{extension}") } else { format!("{stem} {number}.{extension}") };
        match fs::OpenOptions::new().write(true).create_new(true).open(folder.join(&file)) {
            Ok(mut out) => {
                io::Write::write_all(&mut out, bytes)?;
                return Ok(format!("{ASSETS_FOLDER}/{file}"));
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    unreachable!("there is always a free number")
}

/// A file in the workspace (path relative to it), as bytes; nothing outside it.
pub fn read_workspace_file(workspace: &Path, file: &str) -> Result<Vec<u8>, NoteError> {
    let path = inside(workspace, file).ok_or(NoteError::NotFound)?;
    Ok(fs::read(path)?)
}

fn inside(workspace: &Path, file: &str) -> Option<PathBuf> {
    let relative = Path::new(file);
    let plain = relative.components().all(|c| matches!(c, Component::Normal(_)));
    (plain && !file.is_empty()).then(|| workspace.join(relative))
}
