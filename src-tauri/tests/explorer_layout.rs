//! Spec: where the file explorer sits and whether it stays open, remembered per workspace.

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
};

#[test]
fn a_new_workspace_shows_the_explorer_pinned_on_the_left() {
    let workspace = workspace();

    let layout = load_explorer_layout(workspace.path());

    assert_eq!(layout, ExplorerLayout { side: Side::Left, mode: ExplorerMode::Pinned });
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
