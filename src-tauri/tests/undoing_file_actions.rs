//! Spec: what the backend does to undo and redo creating a note. (Undoing a rename is just
//! renaming back, see renaming_a_note.rs.) Undo must never lose anything the user wrote.

use marginalia_lib::notes::*;
use marginalia_lib::workspace::open_folder;
use std::fs;
use tempfile::TempDir;

fn workspace_with(notes: &[(&str, &str)]) -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    for (note, contents) in notes {
        let path = folder.path().join(note);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }
    folder
}

fn exists(workspace: &TempDir, note: &str) -> bool {
    workspace.path().join(note).exists()
}

mod undoing_a_new_note {
    use super::*;

    #[test]
    fn removes_the_note_while_it_is_still_empty() {
        let workspace = workspace_with(&[]);
        let note = create_note(workspace.path(), NoteFormat::Typst).unwrap();

        remove_empty_note(workspace.path(), &note).unwrap();

        assert!(!exists(&workspace, &note));
    }

    #[test]
    fn never_removes_a_note_that_has_text_in_it() {
        let workspace = workspace_with(&[("Untitled.typ", "my first thought")]);

        let error = remove_empty_note(workspace.path(), "Untitled.typ").unwrap_err();

        assert_eq!(error, NoteError::NotEmpty("Untitled.typ".into()));
        assert_eq!(error.to_string(), "\"Untitled.typ\" has text in it now, so it was kept.");
        assert_eq!(fs::read_to_string(workspace.path().join("Untitled.typ")).unwrap(), "my first thought");
    }

    #[test]
    fn a_note_that_is_already_gone_cant_be_removed() {
        let workspace = workspace_with(&[]);

        let error = remove_empty_note(workspace.path(), "Untitled.typ").unwrap_err();

        assert_eq!(error, NoteError::NotFound);
    }

    #[test]
    fn only_removes_notes_not_folders() {
        let workspace = workspace_with(&[]);
        fs::create_dir(workspace.path().join("Papers")).unwrap();

        assert!(remove_empty_note(workspace.path(), "Papers").is_err());
        assert!(exists(&workspace, "Papers"));
    }

    #[test]
    fn only_notes_inside_the_workspace_can_be_removed() {
        let workspace = workspace_with(&[("Papers/Empty.typ", "")]);

        let error = remove_empty_note(&workspace.path().join("Papers"), "../Papers/Empty.typ").unwrap_err();

        assert_eq!(error, NoteError::NotFound);
        assert!(exists(&workspace, "Papers/Empty.typ"));
    }
}

mod redoing_a_new_note {
    use super::*;

    #[test]
    fn brings_the_note_back_empty_with_the_same_name_and_place() {
        let workspace = workspace_with(&[]);
        fs::create_dir(workspace.path().join("Papers")).unwrap();

        restore_empty_note(workspace.path(), "Papers/Untitled.typ").unwrap();

        assert_eq!(fs::read_to_string(workspace.path().join("Papers/Untitled.typ")).unwrap(), "");
    }

    #[test]
    fn never_overwrites_a_note_that_is_there_now() {
        let workspace = workspace_with(&[("Untitled.typ", "written since")]);

        let error = restore_empty_note(workspace.path(), "Untitled.typ").unwrap_err();

        assert_eq!(error, NoteError::AlreadyExists("Untitled.typ".into()));
        assert_eq!(error.to_string(), "There's already a note called \"Untitled.typ\".");
        assert_eq!(fs::read_to_string(workspace.path().join("Untitled.typ")).unwrap(), "written since");
    }

    #[test]
    fn only_notes_inside_the_workspace_can_be_brought_back() {
        let workspace = workspace_with(&[("Papers/x.typ", "")]);

        let error = restore_empty_note(&workspace.path().join("Papers"), "../Escaped.typ").unwrap_err();

        assert_eq!(error, NoteError::NotFound);
        assert!(!exists(&workspace, "Escaped.typ"));
    }
}
