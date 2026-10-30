//! Spec: renaming a note, e.g. right after creating it, to give "Untitled" a real name.
//! The user types only the name; the format (extension) stays the same.

use marginalia_lib::notes::*;
use marginalia_lib::workspace::open_folder;
use std::fs;
use tempfile::TempDir;

fn workspace_with(notes: &[&str]) -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    for note in notes {
        let path = folder.path().join(note);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, format!("contents of {note}")).unwrap();
    }
    folder
}

fn rename(workspace: &TempDir, note: &str, new_name: &str) -> Result<String, RenameError> {
    rename_note(workspace.path(), note, new_name)
}

fn exists(workspace: &TempDir, note: &str) -> bool {
    workspace.path().join(note).is_file()
}

mod renaming_a_note {
    use super::*;

    #[test]
    fn gives_the_note_its_new_name_and_keeps_its_format() {
        let workspace = workspace_with(&["Untitled.typ"]);

        let renamed = rename(&workspace, "Untitled.typ", "Reading list").unwrap();

        assert_eq!(renamed, "Reading list.typ");
        assert!(exists(&workspace, "Reading list.typ"));
        assert!(!exists(&workspace, "Untitled.typ"));
    }

    #[test]
    fn keeps_what_was_written_in_the_note() {
        let workspace = workspace_with(&["Untitled.md"]);

        rename(&workspace, "Untitled.md", "Ideas").unwrap();

        let contents = fs::read_to_string(workspace.path().join("Ideas.md")).unwrap();
        assert_eq!(contents, "contents of Untitled.md");
    }

    #[test]
    fn keeps_the_note_in_its_folder() {
        let workspace = workspace_with(&["Papers/Untitled.typ"]);

        let renamed = rename(&workspace, "Papers/Untitled.typ", "Attention").unwrap();

        assert_eq!(renamed, "Papers/Attention.typ");
        assert!(exists(&workspace, "Papers/Attention.typ"));
    }

    #[test]
    fn ignores_spaces_around_the_name() {
        let workspace = workspace_with(&["Untitled.typ"]);

        let renamed = rename(&workspace, "Untitled.typ", "  Ideas  ").unwrap();

        assert_eq!(renamed, "Ideas.typ");
    }

    #[test]
    fn keeping_the_same_name_changes_nothing() {
        let workspace = workspace_with(&["Untitled.typ"]);

        let renamed = rename(&workspace, "Untitled.typ", "Untitled").unwrap();

        assert_eq!(renamed, "Untitled.typ");
        assert!(exists(&workspace, "Untitled.typ"));
    }

    /// Matters on macOS, where "ideas" and "Ideas" are the same file name.
    #[test]
    fn can_change_only_the_capitalisation_of_the_name() {
        let workspace = workspace_with(&["ideas.typ"]);

        let renamed = rename(&workspace, "ideas.typ", "Ideas").unwrap();

        assert_eq!(renamed, "Ideas.typ");
        let names: Vec<String> = fs::read_dir(workspace.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| !n.starts_with('.'))
            .collect();
        assert_eq!(names, ["Ideas.typ"]);
    }
}

mod names_that_are_not_allowed {
    use super::*;

    #[test]
    fn a_note_needs_a_name() {
        let workspace = workspace_with(&["Untitled.typ"]);

        let error = rename(&workspace, "Untitled.typ", "   ").unwrap_err();

        assert_eq!(error, RenameError::Empty);
        assert_eq!(error.to_string(), "A note needs a name.");
        assert!(exists(&workspace, "Untitled.typ"));
    }

    #[test]
    fn a_name_cant_contain_slashes() {
        let workspace = workspace_with(&["Untitled.typ"]);

        assert_eq!(rename(&workspace, "Untitled.typ", "a/b").unwrap_err(), RenameError::HasSlash);
        assert_eq!(rename(&workspace, "Untitled.typ", "a\\b").unwrap_err(), RenameError::HasSlash);
        assert!(exists(&workspace, "Untitled.typ"));
    }

    /// Names starting with a dot are hidden, so the note would vanish from the explorer.
    #[test]
    fn a_name_cant_start_with_a_dot() {
        let workspace = workspace_with(&["Untitled.typ"]);

        let error = rename(&workspace, "Untitled.typ", ".secret").unwrap_err();

        assert_eq!(error, RenameError::Hidden);
        assert!(exists(&workspace, "Untitled.typ"));
    }

    #[test]
    fn another_note_is_never_overwritten() {
        let workspace = workspace_with(&["Untitled.typ", "Ideas.typ"]);

        let error = rename(&workspace, "Untitled.typ", "Ideas").unwrap_err();

        assert_eq!(error, RenameError::Taken("Ideas".into()));
        assert_eq!(error.to_string(), "There's already a note called \"Ideas\".");
        let ideas = fs::read_to_string(workspace.path().join("Ideas.typ")).unwrap();
        assert_eq!(ideas, "contents of Ideas.typ");
        assert!(exists(&workspace, "Untitled.typ"));
    }

    /// Same rule as for new notes: a link to "Ideas" must point to exactly one note.
    #[test]
    fn a_name_used_by_a_note_in_the_other_format_is_taken() {
        let workspace = workspace_with(&["Untitled.typ", "Ideas.md"]);

        let error = rename(&workspace, "Untitled.typ", "Ideas").unwrap_err();

        assert_eq!(error, RenameError::Taken("Ideas".into()));
    }

    #[test]
    fn only_notes_inside_the_workspace_can_be_renamed() {
        let workspace = workspace_with(&["Untitled.typ"]);

        let error = rename(&workspace, "../Untitled.typ", "Ideas").unwrap_err();

        assert_eq!(error, RenameError::NotFound);
    }

    #[test]
    fn a_note_that_no_longer_exists_cant_be_renamed() {
        let workspace = workspace_with(&[]);

        let error = rename(&workspace, "Untitled.typ", "Ideas").unwrap_err();

        assert_eq!(error, RenameError::NotFound);
        assert_eq!(error.to_string(), "This note doesn't exist anymore.");
    }
}
