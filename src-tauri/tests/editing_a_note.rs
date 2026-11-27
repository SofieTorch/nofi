//! Spec: opening a note to read it, and saving what's typed into it.

use marginalia_lib::files::list_files;
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

fn contents_of(workspace: &TempDir, note: &str) -> String {
    fs::read_to_string(workspace.path().join(note)).unwrap()
}

mod opening_a_note {
    use super::*;

    #[test]
    fn gives_what_is_written_in_it() {
        let workspace = workspace_with(&[("Ideas.typ", "= Ideas\nRead *more* papers.")]);

        let contents = read_note(workspace.path(), "Ideas.typ").unwrap();

        assert_eq!(contents, "= Ideas\nRead *more* papers.");
    }

    #[test]
    fn works_for_notes_in_folders() {
        let workspace = workspace_with(&[("Papers/Attention.md", "# Attention")]);

        let contents = read_note(workspace.path(), "Papers/Attention.md").unwrap();

        assert_eq!(contents, "# Attention");
    }

    #[test]
    fn a_note_that_no_longer_exists_cant_be_opened() {
        let workspace = workspace_with(&[]);

        let error = read_note(workspace.path(), "Ideas.typ").unwrap_err();

        assert_eq!(error, NoteError::NotFound);
        assert_eq!(error.to_string(), "This note doesn't exist anymore.");
    }

    #[test]
    fn only_notes_inside_the_workspace_can_be_opened() {
        let workspace = workspace_with(&[("Papers/Ideas.typ", "")]);

        let error = read_note(&workspace.path().join("Papers"), "../Papers/Ideas.typ").unwrap_err();

        assert_eq!(error, NoteError::NotFound);
    }
}

mod saving_a_note {
    use super::*;

    #[test]
    fn replaces_what_was_written_with_the_new_text() {
        let workspace = workspace_with(&[("Ideas.typ", "a long first draft")]);

        save_note(workspace.path(), "Ideas.typ", "short").unwrap();

        assert_eq!(contents_of(&workspace, "Ideas.typ"), "short");
    }

    #[test]
    fn a_zotero_papers_annotations_are_saved_in_the_apps_folder_made_if_missing() {
        let workspace = workspace_with(&[]);

        save_note(workspace.path(), ".marginalia/zotero/groups/77/UNIPAPER.annotations.json", "{}").unwrap();

        assert_eq!(contents_of(&workspace, ".marginalia/zotero/groups/77/UNIPAPER.annotations.json"), "{}");
    }

    #[test]
    fn a_note_whose_folder_is_gone_isnt_saved_into_a_new_one() {
        let workspace = workspace_with(&[]);

        assert!(save_note(workspace.path(), "Gone/Ideas.typ", "text").is_err());
        assert!(!workspace.path().join("Gone").exists());
    }

    #[test]
    fn keeps_the_text_exactly_as_typed() {
        let workspace = workspace_with(&[("Ideas.typ", "")]);
        let text = "= Café ☕\n\n  indented line\r\nwindows line\n\n";

        save_note(workspace.path(), "Ideas.typ", text).unwrap();

        assert_eq!(read_note(workspace.path(), "Ideas.typ").unwrap(), text);
    }

    #[test]
    fn leaves_other_notes_alone() {
        let workspace = workspace_with(&[("Ideas.typ", ""), ("Other.typ", "untouched")]);

        save_note(workspace.path(), "Ideas.typ", "new text").unwrap();

        assert_eq!(contents_of(&workspace, "Other.typ"), "untouched");
    }

    /// A save is written to a temporary file first, so a crash never leaves a half-written note.
    #[test]
    fn leaves_no_temporary_files_behind() {
        let workspace = workspace_with(&[("Ideas.typ", "")]);

        save_note(workspace.path(), "Ideas.typ", "new text").unwrap();

        let everything: Vec<String> = fs::read_dir(workspace.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name != ".marginalia")
            .collect();
        assert_eq!(everything, ["Ideas.typ"]);
        assert_eq!(list_files(workspace.path()).unwrap().len(), 1);
    }

    /// If the note was deleted outside the app while open, what was typed is still kept.
    #[test]
    fn brings_back_a_note_deleted_while_it_was_open() {
        let workspace = workspace_with(&[]);

        save_note(workspace.path(), "Ideas.typ", "don't lose me").unwrap();

        assert_eq!(contents_of(&workspace, "Ideas.typ"), "don't lose me");
    }

    #[test]
    fn only_notes_inside_the_workspace_can_be_saved() {
        let workspace = workspace_with(&[("Papers/Ideas.typ", "")]);

        let error = save_note(&workspace.path().join("Papers"), "../Escaped.typ", "x").unwrap_err();

        assert_eq!(error, NoteError::NotFound);
        assert!(!workspace.path().join("Escaped.typ").exists());
    }
}
