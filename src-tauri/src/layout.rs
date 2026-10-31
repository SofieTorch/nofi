//! How the user arranged a workspace's window. Saved per workspace, inside `.marginalia/`.

use crate::workspace::APP_DATA_DIR;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Room for more layout settings later (open tabs, panel sizes…).
#[derive(Default, Serialize, Deserialize)]
struct LayoutFile {
    #[serde(default)]
    explorer: ExplorerLayout,
    /// Whether Typst notes are shown as pages next to the editor.
    #[serde(default)]
    show_pages: bool,
}

fn load(workspace: &Path) -> LayoutFile {
    fs::read_to_string(layout_file(workspace))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Changes one setting and keeps the others.
fn update(workspace: &Path, change: impl FnOnce(&mut LayoutFile)) -> io::Result<()> {
    let mut data = load(workspace);
    change(&mut data);
    let file = layout_file(workspace);
    fs::create_dir_all(file.parent().unwrap())?;
    fs::write(file, serde_json::to_string_pretty(&data)?)
}

fn layout_file(workspace: &Path) -> PathBuf {
    workspace.join(APP_DATA_DIR).join("layout.json")
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Side {
    #[default]
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerMode {
    /// Always visible, next to the content.
    #[default]
    Pinned,
    /// Hidden until the mouse reaches its edge of the window, then floats over the content.
    AutoHide,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct ExplorerLayout {
    pub side: Side,
    pub mode: ExplorerMode,
}

pub fn load_explorer_layout(workspace: &Path) -> ExplorerLayout {
    load(workspace).explorer
}

pub fn save_explorer_layout(workspace: &Path, layout: &ExplorerLayout) -> io::Result<()> {
    update(workspace, |data| data.explorer = *layout)
}

/// Whether Typst notes are shown as pages next to the editor (hidden until turned on).
pub fn load_show_pages(workspace: &Path) -> bool {
    load(workspace).show_pages
}

pub fn save_show_pages(workspace: &Path, show: bool) -> io::Result<()> {
    update(workspace, |data| data.show_pages = show)
}
