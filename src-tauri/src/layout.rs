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
    /// What's hidden in the sidebar's Library: Zotero libraries and collections, by id.
    #[serde(default)]
    hidden_in_library: Vec<String>,
    /// The explorer's open folders, by path.
    #[serde(default)]
    open_folders: Vec<String>,
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
    /// Which of the sidebar's sections are folded away (all open at first).
    #[serde(default)]
    pub collapsed: Collapsed,
}

/// The sidebar's sections, each folded away or not.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Collapsed {
    pub files: bool,
    pub library: bool,
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

/// What's hidden in the sidebar's Library (Zotero libraries and collections, by id).
pub fn load_hidden_in_library(workspace: &Path) -> Vec<String> {
    load(workspace).hidden_in_library
}

pub fn save_hidden_in_library(workspace: &Path, hidden: &[String]) -> io::Result<()> {
    update(workspace, |data| data.hidden_in_library = hidden.to_vec())
}

/// The explorer's open folders (their paths), so they're open again next time.
pub fn load_open_folders(workspace: &Path) -> Vec<String> {
    load(workspace).open_folders
}

pub fn save_open_folders(workspace: &Path, open: &[String]) -> io::Result<()> {
    update(workspace, |data| data.open_folders = open.to_vec())
}
