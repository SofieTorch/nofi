//! Spec: deleting a file from the explorer (after the user confirms). It goes to the system's
//! Trash, so it can still be brought back from there. Here a stand-in records what would go to
//! the Trash, so the tests don't fill the real one.

use marginalia_lib::notes::*;
use marginalia_lib::workspace::open_folder;
use std::cell::RefCell;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

fn workspace_with(files: &[&str]) -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    for file in files {
        let path = folder.path().join(file);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "something").unwrap();
    }
    folder
}

/// Deletes `file`, returning what went to the (stand-in) Trash.
fn delete(workspace: &TempDir, file: &str) -> (Result<(), NoteError>, Vec<PathBuf>) {
    let trashed = RefCell::new(Vec::new());
    let result = delete_file_with(workspace.path(), file, |path| {
        trashed.borrow_mut().push(path.to_path_buf());
        fs::remove_file(path)
    });
    (result, trashed.into_inner())
}

mod deleting_a_file {
    use super::*;

    #[test]
    fn sends_the_file_to_the_trash() {
        let workspace = workspace_with(&["Paper.typ", "Other.typ"]);

        let (result, trashed) = delete(&workspace, "Paper.typ");

        assert_eq!(result, Ok(()));
        assert_eq!(trashed, vec![workspace.path().join("Paper.typ")]);
        assert!(!workspace.path().join("Paper.typ").exists());
        assert!(workspace.path().join("Other.typ").exists());
    }

    #[test]
    fn works_for_a_file_in_a_folder_and_for_any_kind_of_file() {
        let workspace = workspace_with(&["Papers/attention.pdf"]);

        let (result, _) = delete(&workspace, "Papers/attention.pdf");

        assert_eq!(result, Ok(()));
        assert!(!workspace.path().join("Papers/attention.pdf").exists());
        assert!(workspace.path().join("Papers").is_dir());
    }

    #[test]
    fn a_file_that_isnt_there_anymore_says_so() {
        let workspace = workspace_with(&[]);

        let (result, trashed) = delete(&workspace, "Gone.typ");

        assert_eq!(result, Err(NoteError::NotFound));
        assert!(trashed.is_empty());
    }

    #[test]
    fn never_touches_anything_outside_the_workspace() {
        let outside = workspace_with(&["Secret.typ"]);
        let workspace = workspace_with(&[]);
        let sneaky = format!("../{}/Secret.typ", outside.path().file_name().unwrap().to_string_lossy());

        let (result, trashed) = delete(&workspace, &sneaky);

        assert_eq!(result, Err(NoteError::NotFound));
        assert!(trashed.is_empty());
        assert!(outside.path().join("Secret.typ").exists());
    }

    #[test]
    fn a_folder_isnt_deleted_this_way() {
        let workspace = workspace_with(&["Papers/a.typ"]);

        let (result, trashed) = delete(&workspace, "Papers");

        assert_eq!(result, Err(NoteError::NotFound));
        assert!(trashed.is_empty());
    }

    #[test]
    fn deleting_a_pdf_sends_its_annotations_to_the_trash_too() {
        let workspace = workspace_with(&["attention.pdf", "attention.annotations.json", "attention notes.typ"]);

        let (result, trashed) = delete(&workspace, "attention.pdf");

        assert_eq!(result, Ok(()));
        assert_eq!(trashed, vec![workspace.path().join("attention.pdf"), workspace.path().join("attention.annotations.json")]);
        // (Notes about it are notes: they stay.)
        assert!(workspace.path().join("attention notes.typ").exists());
    }
}
