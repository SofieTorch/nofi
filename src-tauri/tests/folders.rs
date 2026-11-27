//! Spec: the explorer's file actions, like VS Code's: new notes and folders in any folder,
//! renaming and deleting folders (to the system's Trash), and moving or copying files and folders
//! into other folders. A PDF's annotations always go with it. Nothing outside the workspace is
//! ever touched.

use marginalia_lib::folders::*;
use marginalia_lib::layout::{load_open_folders, save_open_folders};
use marginalia_lib::notes::{create_board, create_note_in, NoteFormat, RenameError};
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
        if file.ends_with('/') {
            fs::create_dir_all(path).unwrap();
        } else {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, format!("contents of {file}")).unwrap();
        }
    }
    folder
}

fn exists(workspace: &TempDir, path: &str) -> bool {
    workspace.path().join(path).exists()
}

fn contents(workspace: &TempDir, path: &str) -> String {
    fs::read_to_string(workspace.path().join(path)).unwrap()
}

mod new_notes {
    use super::*;

    #[test]
    fn a_new_note_goes_in_the_folder_given() {
        let workspace = workspace_with(&["Papers/"]);

        assert_eq!(create_note_in(workspace.path(), NoteFormat::Typst, "Papers").unwrap(), "Papers/Untitled.typ");
        assert!(exists(&workspace, "Papers/Untitled.typ"));
    }

    #[test]
    fn its_name_is_free_in_that_folder() {
        let workspace = workspace_with(&["Papers/Untitled.typ", "Untitled 2.typ"]);

        assert_eq!(create_note_in(workspace.path(), NoteFormat::Markdown, "Papers").unwrap(), "Papers/Untitled 2.md");
    }

    #[test]
    fn with_no_folder_it_goes_at_the_top() {
        let workspace = workspace_with(&[]);

        assert_eq!(create_note_in(workspace.path(), NoteFormat::Typst, "").unwrap(), "Untitled.typ");
    }

    #[test]
    fn not_in_a_folder_that_isnt_there_or_outside_the_workspace() {
        let workspace = workspace_with(&[]);

        assert!(create_note_in(workspace.path(), NoteFormat::Typst, "Gone").is_err());
        assert!(create_note_in(workspace.path(), NoteFormat::Typst, "..").is_err());
    }

    #[test]
    fn boards_still_go_at_the_top() {
        let workspace = workspace_with(&[]);

        assert_eq!(create_board(workspace.path()).unwrap(), "Untitled.canvas");
    }
}

mod new_folders {
    use super::*;

    #[test]
    fn is_called_new_folder_in_the_folder_given() {
        let workspace = workspace_with(&["Papers/"]);

        assert_eq!(create_folder(workspace.path(), "Papers").unwrap(), "Papers/New folder");
        assert!(workspace.path().join("Papers/New folder").is_dir());
    }

    #[test]
    fn gets_a_number_if_the_name_is_taken() {
        let workspace = workspace_with(&["New folder/"]);

        assert_eq!(create_folder(workspace.path(), "").unwrap(), "New folder 2");
    }
}

mod renaming_a_folder {
    use super::*;

    #[test]
    fn gives_it_the_new_name_keeping_what_is_inside() {
        let workspace = workspace_with(&["Papers/attention.pdf"]);

        assert_eq!(rename_folder(workspace.path(), "Papers", "Reading").unwrap(), "Reading");
        assert!(exists(&workspace, "Reading/attention.pdf"));
        assert!(!exists(&workspace, "Papers"));
    }

    #[test]
    fn stays_in_its_parent_folder() {
        let workspace = workspace_with(&["Thesis/Papers/"]);

        assert_eq!(rename_folder(workspace.path(), "Thesis/Papers", "Reading").unwrap(), "Thesis/Reading");
    }

    #[test]
    fn refuses_names_that_cant_be_used() {
        let workspace = workspace_with(&["Papers/", "Reading/"]);

        assert_eq!(rename_folder(workspace.path(), "Papers", "  "), Err(RenameError::Empty));
        assert_eq!(rename_folder(workspace.path(), "Papers", "a/b"), Err(RenameError::HasSlash));
        assert_eq!(rename_folder(workspace.path(), "Papers", ".hidden"), Err(RenameError::Hidden));
        assert_eq!(rename_folder(workspace.path(), "Papers", "Reading"), Err(RenameError::Taken("Reading".into())));
    }

    #[test]
    fn changing_only_capitals_is_fine() {
        let workspace = workspace_with(&["papers/a.typ"]);

        assert_eq!(rename_folder(workspace.path(), "papers", "Papers").unwrap(), "Papers");
        assert!(exists(&workspace, "Papers/a.typ"));
    }
}

mod deleting_a_folder {
    use super::*;

    fn delete(workspace: &TempDir, folder: &str) -> (Result<(), FileError>, Vec<PathBuf>) {
        let trashed = RefCell::new(Vec::new());
        let result = delete_folder_with(workspace.path(), folder, |path| {
            trashed.borrow_mut().push(path.to_path_buf());
            fs::remove_dir_all(path)
        });
        (result, trashed.into_inner())
    }

    #[test]
    fn sends_it_to_the_trash_with_everything_in_it() {
        let workspace = workspace_with(&["Papers/a.typ", "Papers/Old/b.md", "Keep.typ"]);

        let (result, trashed) = delete(&workspace, "Papers");

        assert_eq!(result, Ok(()));
        assert_eq!(trashed, vec![workspace.path().join("Papers")]);
        assert!(!exists(&workspace, "Papers"));
        assert!(exists(&workspace, "Keep.typ"));
    }

    #[test]
    fn never_the_workspace_itself_or_anything_outside() {
        let workspace = workspace_with(&[]);

        assert!(delete(&workspace, "").1.is_empty());
        assert!(delete(&workspace, "..").1.is_empty());
        assert!(delete(&workspace, ".marginalia").1.is_empty());
    }

    #[test]
    fn counts_the_files_inside_to_ask_first() {
        let workspace = workspace_with(&["Papers/a.typ", "Papers/Old/b.md", "Papers/Old/c.pdf", "Papers/Old/c.annotations.json", "Empty/"]);

        assert_eq!(files_in(workspace.path(), "Papers").unwrap(), 3);
        assert_eq!(files_in(workspace.path(), "Empty").unwrap(), 0);
    }
}

mod moving {
    use super::*;

    #[test]
    fn moves_a_file_into_a_folder() {
        let workspace = workspace_with(&["Ideas.typ", "Papers/"]);

        assert_eq!(move_into(workspace.path(), "Ideas.typ", "Papers").unwrap(), "Papers/Ideas.typ");
        assert_eq!(contents(&workspace, "Papers/Ideas.typ"), "contents of Ideas.typ");
        assert!(!exists(&workspace, "Ideas.typ"));
    }

    #[test]
    fn moves_a_folder_with_everything_in_it_and_up_to_the_top() {
        let workspace = workspace_with(&["Thesis/Papers/a.typ"]);

        assert_eq!(move_into(workspace.path(), "Thesis/Papers", "").unwrap(), "Papers");
        assert!(exists(&workspace, "Papers/a.typ"));
    }

    #[test]
    fn a_pdfs_annotations_go_with_it() {
        let workspace = workspace_with(&["attention.pdf", "attention.annotations.json", "Papers/"]);

        move_into(workspace.path(), "attention.pdf", "Papers").unwrap();

        assert!(exists(&workspace, "Papers/attention.annotations.json"));
        assert!(!exists(&workspace, "attention.annotations.json"));
    }

    #[test]
    fn wont_replace_something_with_the_same_name() {
        let workspace = workspace_with(&["Ideas.typ", "Papers/Ideas.typ"]);

        assert_eq!(move_into(workspace.path(), "Ideas.typ", "Papers"), Err(FileError::Taken("Ideas.typ".into())));
        assert_eq!(contents(&workspace, "Papers/Ideas.typ"), "contents of Papers/Ideas.typ");
    }

    #[test]
    fn a_folder_cant_go_inside_itself() {
        let workspace = workspace_with(&["Thesis/Papers/"]);

        assert_eq!(move_into(workspace.path(), "Thesis", "Thesis/Papers"), Err(FileError::IntoItself));
        assert_eq!(move_into(workspace.path(), "Thesis", "Thesis"), Err(FileError::IntoItself));
    }

    #[test]
    fn moving_to_where_it_already_is_changes_nothing() {
        let workspace = workspace_with(&["Papers/Ideas.typ"]);

        assert_eq!(move_into(workspace.path(), "Papers/Ideas.typ", "Papers").unwrap(), "Papers/Ideas.typ");
    }

    #[test]
    fn nothing_outside_the_workspace() {
        let workspace = workspace_with(&["Ideas.typ"]);

        assert!(move_into(workspace.path(), "Ideas.typ", "..").is_err());
        assert!(move_into(workspace.path(), "../x", "").is_err());
        assert!(exists(&workspace, "Ideas.typ"));
    }
}

mod copying {
    use super::*;

    #[test]
    fn copies_a_file_into_a_folder_keeping_the_original() {
        let workspace = workspace_with(&["Ideas.typ", "Papers/"]);

        assert_eq!(copy_into(workspace.path(), "Ideas.typ", "Papers").unwrap(), "Papers/Ideas.typ");
        assert_eq!(contents(&workspace, "Papers/Ideas.typ"), "contents of Ideas.typ");
        assert!(exists(&workspace, "Ideas.typ"));
    }

    #[test]
    fn a_name_thats_taken_gets_copy_after_it() {
        let workspace = workspace_with(&["Ideas.typ"]);

        assert_eq!(copy_into(workspace.path(), "Ideas.typ", "").unwrap(), "Ideas copy.typ");
        assert_eq!(copy_into(workspace.path(), "Ideas.typ", "").unwrap(), "Ideas copy 2.typ");
    }

    #[test]
    fn copies_a_folder_with_everything_in_it() {
        let workspace = workspace_with(&["Papers/a.typ", "Papers/Old/b.md", "Thesis/"]);

        assert_eq!(copy_into(workspace.path(), "Papers", "Thesis").unwrap(), "Thesis/Papers");
        assert_eq!(contents(&workspace, "Thesis/Papers/Old/b.md"), "contents of Papers/Old/b.md");
        assert!(exists(&workspace, "Papers/Old/b.md"));
    }

    #[test]
    fn a_pdfs_annotations_are_copied_with_it() {
        let workspace = workspace_with(&["attention.pdf", "attention.annotations.json"]);

        assert_eq!(copy_into(workspace.path(), "attention.pdf", "").unwrap(), "attention copy.pdf");
        assert!(exists(&workspace, "attention copy.annotations.json"));
    }

    #[test]
    fn a_folder_cant_be_copied_inside_itself() {
        let workspace = workspace_with(&["Thesis/Papers/"]);

        assert_eq!(copy_into(workspace.path(), "Thesis", "Thesis/Papers"), Err(FileError::IntoItself));
    }
}

mod open_folders {
    use super::*;

    #[test]
    fn which_folders_are_open_is_kept_per_workspace() {
        let workspace = workspace_with(&[]);
        assert!(load_open_folders(workspace.path()).is_empty());

        save_open_folders(workspace.path(), &["Papers".into(), "Papers/Old".into()]).unwrap();

        assert_eq!(load_open_folders(workspace.path()), vec!["Papers".to_string(), "Papers/Old".to_string()]);
    }
}
