//! The workspace is the folder the user picks to hold all their notes, PDFs and boards.
//! Everything Marginalia stores lives inside it, so the app works fully offline and the
//! user owns their files.

use serde::{Deserialize, Serialize, Serializer};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

/// Name of the hidden folder, inside the workspace, where the app keeps its own data.
pub const APP_DATA_DIR: &str = ".marginalia";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Workspace {
    pub name: String,
    pub path: PathBuf,
}

#[derive(Debug, PartialEq)]
pub enum WorkspaceError {
    NotFound(PathBuf),
    NotAFolder(PathBuf),
    Io(String),
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(_) => write!(f, "This folder doesn't exist anymore."),
            Self::NotAFolder(_) => write!(f, "Please choose a folder, not a file."),
            Self::Io(reason) => write!(f, "This folder can't be used: {reason}"),
        }
    }
}

/// Sent to the frontend as a readable message.
impl Serialize for WorkspaceError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for WorkspaceError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

/// Where the app remembers things between launches (outside any workspace).
pub struct Settings {
    file: PathBuf,
}

#[derive(Default, Serialize, Deserialize)]
struct SettingsData {
    last_workspace: Option<PathBuf>,
    #[serde(default)]
    recent_workspaces: Vec<PathBuf>,
    #[serde(default)]
    editor: EditorSettings,
    #[serde(default)]
    sidebar: SidebarSizes,
}

/// The sidebar's width (in pixels), and the share of its height the Files section has when the
/// Library is open too. The same in every workspace.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SidebarSizes {
    pub width: f64,
    pub files_share: f64,
}

impl Default for SidebarSizes {
    fn default() -> Self {
        Self { width: 256.0, files_share: 0.5 }
    }
}

pub fn sidebar_sizes(settings: &Settings) -> SidebarSizes {
    settings.load().sidebar
}

pub fn save_sidebar_sizes(settings: &Settings, sizes: &SidebarSizes) -> std::io::Result<()> {
    let mut data = settings.load();
    data.sidebar = *sizes;
    settings.save(&data)
}

/// How the editor behaves, in every workspace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorSettings {
    /// Whether blocks show a handle in the margin to drag them around.
    pub block_handles: bool,
    /// What boards are drawn on.
    pub board_background: BoardBackground,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self { block_handles: true, board_background: BoardBackground::Plain }
    }
}

/// A board's background: plain white (the default), or a grid like Miro's to line things up by.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BoardBackground {
    #[default]
    #[serde(alias = "dots")]
    Plain,
    #[serde(alias = "lines")]
    Grid,
}

pub fn editor_settings(settings: &Settings) -> EditorSettings {
    settings.load().editor
}

pub fn save_editor_settings(settings: &Settings, editor: &EditorSettings) -> std::io::Result<()> {
    let mut data = settings.load();
    data.editor = editor.clone();
    settings.save(&data)
}

impl Settings {
    pub fn at(file: impl Into<PathBuf>) -> Self {
        Self { file: file.into() }
    }

    fn load(&self) -> SettingsData {
        fs::read_to_string(&self.file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save(&self, data: &SettingsData) -> std::io::Result<()> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(&self.file, serde_json::to_string_pretty(data)?)
    }
}

pub fn open_folder(path: &Path) -> Result<Workspace, WorkspaceError> {
    if !path.exists() {
        return Err(WorkspaceError::NotFound(path.to_path_buf()));
    }
    if !path.is_dir() {
        return Err(WorkspaceError::NotAFolder(path.to_path_buf()));
    }
    fs::create_dir_all(path.join(APP_DATA_DIR))?;

    Ok(Workspace { name: folder_name(path), path: path.to_path_buf() })
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

pub fn open_and_remember(path: &Path, settings: &Settings) -> Result<Workspace, WorkspaceError> {
    let workspace = open_folder(path)?;
    let mut data = settings.load();
    data.last_workspace = Some(workspace.path.clone());
    data.recent_workspaces.retain(|p| p != &workspace.path);
    data.recent_workspaces.insert(0, workspace.path.clone());
    data.recent_workspaces.truncate(MAX_RECENT_WORKSPACES);
    settings.save(&data)?;
    Ok(workspace)
}

pub fn restore_last_workspace(settings: &Settings) -> Option<Workspace> {
    let path = settings.load().last_workspace?;
    open_folder(&path).ok()
}

/// How many recently used workspaces the picker offers.
pub const MAX_RECENT_WORKSPACES: usize = 10;

pub fn close_workspace(settings: &Settings) -> Result<(), WorkspaceError> {
    let mut data = settings.load();
    data.last_workspace = None;
    settings.save(&data)?;
    Ok(())
}

/// Only checks the folders still exist; listing must not change anything on disk.
pub fn recent_workspaces(settings: &Settings) -> Vec<Workspace> {
    settings
        .load()
        .recent_workspaces
        .into_iter()
        .filter(|path| path.is_dir())
        .map(|path| Workspace { name: folder_name(&path), path })
        .collect()
}
