//! Spec: the workspace's folder is watched, so the explorer shows files as they come and go
//! (made in Finder, by another app, or synced). Changes in the app's own `.marginalia` folder
//! don't count. Quick runs of changes are told once.

use marginalia_lib::watch::watch_workspace;
use marginalia_lib::workspace::open_folder;
use std::fs;
use std::sync::mpsc;
use std::time::Duration;
use tempfile::TempDir;

fn watched() -> (TempDir, mpsc::Receiver<()>, impl Drop) {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    let (tell, told) = mpsc::channel();
    let watcher = watch_workspace(folder.path(), move || {
        let _ = tell.send(());
    })
    .unwrap();
    // (The watcher takes a moment to start.)
    std::thread::sleep(Duration::from_millis(200));
    (folder, told, watcher)
}

#[test]
fn a_new_file_is_told() {
    let (folder, told, _watcher) = watched();

    fs::write(folder.path().join("New.typ"), "").unwrap();

    assert!(told.recv_timeout(Duration::from_secs(5)).is_ok());
}

#[test]
fn a_deleted_or_renamed_file_is_told() {
    let (folder, told, _watcher) = watched();
    fs::write(folder.path().join("A.typ"), "").unwrap();
    told.recv_timeout(Duration::from_secs(5)).unwrap();
    while told.recv_timeout(Duration::from_millis(500)).is_ok() {}

    fs::rename(folder.path().join("A.typ"), folder.path().join("B.typ")).unwrap();

    assert!(told.recv_timeout(Duration::from_secs(5)).is_ok());
}

#[test]
fn files_in_folders_count_too() {
    let (folder, told, _watcher) = watched();

    fs::create_dir(folder.path().join("Papers")).unwrap();
    fs::write(folder.path().join("Papers/Attention.typ"), "").unwrap();

    assert!(told.recv_timeout(Duration::from_secs(5)).is_ok());
}

#[test]
fn the_apps_own_folder_doesnt_count() {
    let (folder, told, _watcher) = watched();

    fs::write(folder.path().join(".marginalia/layout.json"), "{}").unwrap();

    assert!(told.recv_timeout(Duration::from_secs(2)).is_err());
}

#[test]
fn many_changes_at_once_are_told_once() {
    let (folder, told, _watcher) = watched();

    for n in 0..20 {
        fs::write(folder.path().join(format!("Note {n}.typ")), "").unwrap();
    }

    told.recv_timeout(Duration::from_secs(5)).unwrap();
    let more = std::iter::from_fn(|| told.recv_timeout(Duration::from_millis(800)).ok()).count();
    assert!(more <= 1, "told {} more times", more);
}
