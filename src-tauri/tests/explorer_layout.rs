//! Spec: where the file explorer (the sidebar) sits, whether it stays open, and which of its
//! sections (Files, Library) are folded away, remembered per workspace.

use marginalia_lib::layout::*;
use marginalia_lib::workspace::{open_folder, APP_DATA_DIR};
use std::fs;
use tempfile::TempDir;

fn workspace() -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    folder
}

const RIGHT_AND_AUTO_HIDDEN: ExplorerLayout = ExplorerLayout {
    side: Side::Right,
    mode: ExplorerMode::AutoHide,
    collapsed: Collapsed { files: false, library: true },
};

#[test]
fn a_new_workspace_shows_the_explorer_pinned_on_the_left() {
    let workspace = workspace();

    let layout = load_explorer_layout(workspace.path());

    assert_eq!(layout, ExplorerLayout { side: Side::Left, mode: ExplorerMode::Pinned, collapsed: Collapsed::default() });
}

#[test]
fn every_section_is_open_at_first() {
    let workspace = workspace();

    assert_eq!(load_explorer_layout(workspace.path()).collapsed, Collapsed { files: false, library: false });
}

/// Layouts saved before the sidebar had sections still open the same way.
#[test]
fn a_layout_saved_before_there_were_sections_keeps_its_side_and_mode() {
    let workspace = workspace();
    save_explorer_layout(workspace.path(), &RIGHT_AND_AUTO_HIDDEN).unwrap();
    let app_data = workspace.path().join(APP_DATA_DIR);
    for file in fs::read_dir(&app_data).unwrap() {
        fs::write(file.unwrap().path(), r#"{"explorer":{"side":"right","mode":"auto-hide"}}"#).unwrap();
    }

    let layout = load_explorer_layout(workspace.path());

    assert_eq!((layout.side, layout.mode, layout.collapsed), (Side::Right, ExplorerMode::AutoHide, Collapsed::default()));
}

#[test]
fn the_explorer_layout_is_the_same_when_the_workspace_is_opened_again() {
    let workspace = workspace();

    save_explorer_layout(workspace.path(), &RIGHT_AND_AUTO_HIDDEN).unwrap();

    assert_eq!(load_explorer_layout(workspace.path()), RIGHT_AND_AUTO_HIDDEN);
}

#[test]
fn each_workspace_remembers_its_own_explorer_layout() {
    let research = workspace();
    let thesis = workspace();

    save_explorer_layout(research.path(), &RIGHT_AND_AUTO_HIDDEN).unwrap();

    assert_eq!(load_explorer_layout(thesis.path()), ExplorerLayout::default());
}

/// The layout travels with the folder, e.g. when it's synced to another computer.
#[test]
fn the_layout_is_saved_inside_the_workspace_app_data_folder() {
    let workspace = workspace();

    save_explorer_layout(workspace.path(), &RIGHT_AND_AUTO_HIDDEN).unwrap();

    let app_data: Vec<_> = fs::read_dir(workspace.path().join(APP_DATA_DIR)).unwrap().collect();
    assert_eq!(app_data.len(), 1);
    let workspace_root: Vec<_> = fs::read_dir(workspace.path()).unwrap().collect();
    assert_eq!(workspace_root.len(), 1, "only the app data folder should exist at the root");
}

/// A damaged layout file should never stop a workspace from opening.
#[test]
fn a_damaged_layout_file_falls_back_to_the_default_layout() {
    let workspace = workspace();
    save_explorer_layout(workspace.path(), &RIGHT_AND_AUTO_HIDDEN).unwrap();
    let app_data = workspace.path().join(APP_DATA_DIR);
    for file in fs::read_dir(&app_data).unwrap() {
        fs::write(file.unwrap().path(), "not json {{{").unwrap();
    }

    assert_eq!(load_explorer_layout(workspace.path()), ExplorerLayout::default());
}

/// What's hidden in the sidebar's Library (Zotero libraries and collections, by id): per workspace.
mod hidden_in_the_library {
    use super::*;

    #[test]
    fn nothing_is_hidden_at_first() {
        let workspace = workspace();

        assert!(load_hidden_in_library(workspace.path()).is_empty());
    }

    #[test]
    fn what_is_hidden_is_remembered_for_the_workspace_only() {
        let thesis = workspace();
        let course = workspace();
        let hidden = vec!["groups/77".to_string(), "user/collections/PERSONAL".to_string()];

        save_hidden_in_library(thesis.path(), &hidden).unwrap();

        assert_eq!(load_hidden_in_library(thesis.path()), hidden);
        assert!(load_hidden_in_library(course.path()).is_empty());
    }

    #[test]
    fn the_rest_of_the_layout_is_kept() {
        let workspace = workspace();
        save_explorer_layout(workspace.path(), &RIGHT_AND_AUTO_HIDDEN).unwrap();

        save_hidden_in_library(workspace.path(), &["groups/77".to_string()]).unwrap();

        assert_eq!(load_explorer_layout(workspace.path()), RIGHT_AND_AUTO_HIDDEN);
    }
}
