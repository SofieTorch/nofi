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
    fs::read_to_string(layout_file(workspace))
        .ok()
        .and_then(|text| serde_json::from_str::<LayoutFile>(&text).ok())
        .unwrap_or_default()
        .explorer
}

pub fn save_explorer_layout(workspace: &Path, layout: &ExplorerLayout) -> io::Result<()> {
    let file = layout_file(workspace);
    fs::create_dir_all(file.parent().unwrap())?;
    let data = LayoutFile { explorer: *layout };
    fs::write(file, serde_json::to_string_pretty(&data)?)
}
