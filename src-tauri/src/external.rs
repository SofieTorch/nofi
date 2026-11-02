//! What clicking a link may open outside the app: websites and email addresses (in the browser or
//! mail app), and files in the workspace (in their own app). Nothing else.

use std::path::{Component, Path, PathBuf};

/// The address, if it's one that may be opened: a website or an email address.
pub fn checked_url(url: &str) -> Result<String, String> {
    let lower = url.to_lowercase();
    let allowed = ["http://", "https://", "mailto:"].iter().any(|scheme| lower.starts_with(scheme));
    if allowed && !url.chars().any(char::is_whitespace) {
        Ok(url.to_string())
    } else {
        Err(format!("\"{url}\" can't be opened from a note."))
    }
}

/// The real path of a file in the workspace (path relative to it), if it's there.
pub fn checked_file(workspace: &Path, file: &str) -> Result<PathBuf, String> {
    let relative = Path::new(file);
    let plain = !file.is_empty() && relative.components().all(|c| matches!(c, Component::Normal(_)));
    let path = workspace.join(relative);
    if plain && path.is_file() {
        Ok(path)
    } else {
        Err(format!("\"{}\" isn't in the workspace.", file.rsplit('/').next().unwrap_or(file)))
    }
}
