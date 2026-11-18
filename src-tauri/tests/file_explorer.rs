//! Spec: what the file explorer lists for an open workspace.

use marginalia_lib::files::*;
use marginalia_lib::workspace::open_folder;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

/// A freshly opened workspace, so it already has its `.marginalia` folder like in the app.
fn workspace() -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    folder
}

fn add_file(workspace: &TempDir, relative_path: &str) {
    let path = workspace.path().join(relative_path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, "").unwrap();
}

fn add_folder(workspace: &TempDir, relative_path: &str) {
    fs::create_dir_all(workspace.path().join(relative_path)).unwrap();
}

fn names(entries: &[FileEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

fn list(workspace: &TempDir) -> Vec<FileEntry> {
    list_files(workspace.path()).unwrap()
}

mod listing_the_workspace {
    use super::*;

    #[test]
    fn an_empty_workspace_has_nothing_to_list() {
        let workspace = workspace();

        assert!(list(&workspace).is_empty());
    }

    #[test]
    fn a_pdfs_annotations_file_isnt_listed_its_kept_with_the_pdf() {
        let workspace = workspace();
        add_file(&workspace, "Papers/attention.pdf");
        add_file(&workspace, "Papers/attention.annotations.json");
        add_file(&workspace, "Papers/data.json");

        let entries = list(&workspace);

        assert_eq!(names(&entries[0].children), vec!["attention.pdf", "data.json"]);
    }

    #[test]
    fn files_and_folders_in_the_workspace_are_listed() {
        let workspace = workspace();
        add_file(&workspace, "ideas.md");
        add_folder(&workspace, "Papers");

        let entries = list(&workspace);

        assert_eq!(names(&entries), ["Papers", "ideas.md"]);
        assert_eq!(entries[0].kind, EntryKind::Folder);
        assert_eq!(entries[1].kind, EntryKind::File);
    }

    #[test]
    fn the_contents_of_subfolders_are_listed_inside_their_folder() {
        let workspace = workspace();
        add_file(&workspace, "Papers/2024/attention.pdf");

        let entries = list(&workspace);

        let papers = &entries[0];
        let year = &papers.children[0];
        assert_eq!(names(&year.children), ["attention.pdf"]);
    }

    /// The frontend never needs to know where the workspace lives on disk.
    #[test]
    fn paths_are_relative_to_the_workspace_folder() {
        let workspace = workspace();
        add_file(&workspace, "Papers/attention.pdf");

        let entries = list(&workspace);

        assert_eq!(entries[0].path, "Papers");
        assert_eq!(entries[0].children[0].path, "Papers/attention.pdf");
    }

    /// Every file the user put in the folder shows up, not only the ones the app can open.
    #[test]
    fn files_of_any_type_are_listed() {
        let workspace = workspace();
        add_file(&workspace, "data.csv");
        add_file(&workspace, "photo.jpg");

        assert_eq!(names(&list(&workspace)), ["data.csv", "photo.jpg"]);
    }
}

mod hidden_files {
    use super::*;

    #[test]
    fn the_app_data_folder_is_not_listed() {
        let workspace = workspace();
        add_file(&workspace, "ideas.md");

        assert_eq!(names(&list(&workspace)), ["ideas.md"]);
    }

    /// Things like `.git` or macOS's `.DS_Store` are not the user's notes.
    #[test]
    fn hidden_files_and_folders_are_not_listed() {
        let workspace = workspace();
        add_file(&workspace, ".DS_Store");
        add_file(&workspace, ".git/config");
        add_file(&workspace, "ideas.md");

        assert_eq!(names(&list(&workspace)), ["ideas.md"]);
    }

    #[test]
    fn hidden_files_inside_subfolders_are_not_listed_either() {
        let workspace = workspace();
        add_file(&workspace, "Papers/.DS_Store");
        add_file(&workspace, "Papers/attention.pdf");

        assert_eq!(names(&list(&workspace)[0].children), ["attention.pdf"]);
    }
}

mod sorting {
    use super::*;

    #[test]
    fn folders_come_before_files() {
        let workspace = workspace();
        add_file(&workspace, "a note.md");
        add_folder(&workspace, "Zotero exports");

        assert_eq!(names(&list(&workspace)), ["Zotero exports", "a note.md"]);
    }

    #[test]
    fn names_are_sorted_alphabetically_ignoring_upper_and_lower_case() {
        let workspace = workspace();
        add_file(&workspace, "banana.md");
        add_file(&workspace, "Apple.md");
        add_file(&workspace, "cherry.md");

        assert_eq!(names(&list(&workspace)), ["Apple.md", "banana.md", "cherry.md"]);
    }

    /// So "Paper 2" comes before "Paper 10", as a person would expect.
    #[test]
    fn numbers_in_names_are_sorted_by_their_value() {
        let workspace = workspace();
        add_file(&workspace, "Paper 10.pdf");
        add_file(&workspace, "Paper 2.pdf");
        add_file(&workspace, "Paper 1.pdf");

        assert_eq!(names(&list(&workspace)), ["Paper 1.pdf", "Paper 2.pdf", "Paper 10.pdf"]);
    }

    #[test]
    fn subfolder_contents_are_sorted_the_same_way() {
        let workspace = workspace();
        add_file(&workspace, "Papers/Paper 10.pdf");
        add_file(&workspace, "Papers/Paper 2.pdf");
        add_folder(&workspace, "Papers/Drafts");

        let papers = &list(&workspace)[0];

        assert_eq!(names(&papers.children), ["Drafts", "Paper 2.pdf", "Paper 10.pdf"]);
    }
}

#[test]
fn listing_files_does_not_change_anything_in_the_workspace() {
    let workspace = workspace();
    add_file(&workspace, "Papers/attention.pdf");
    let before = snapshot(workspace.path());

    list(&workspace);

    assert_eq!(snapshot(workspace.path()), before);
}

fn snapshot(dir: &Path) -> Vec<String> {
    let mut paths = vec![];
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        paths.push(path.display().to_string());
        if path.is_dir() {
            paths.extend(snapshot(&path));
        }
    }
    paths.sort();
    paths
}
