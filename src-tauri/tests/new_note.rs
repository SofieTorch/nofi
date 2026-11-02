//! Spec: creating a new note in the workspace.

use marginalia_lib::files::list_files;
use marginalia_lib::notes::*;
use marginalia_lib::workspace::open_folder;
use std::fs;
use tempfile::TempDir;

fn workspace() -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    folder
}

fn new_note(workspace: &TempDir, format: NoteFormat) -> String {
    create_note(workspace.path(), format).unwrap()
}

mod creating_a_note {
    use super::*;

    #[test]
    fn new_notes_are_typst_by_default() {
        assert_eq!(NoteFormat::default(), NoteFormat::Typst);
    }

    #[test]
    fn a_typst_note_is_a_typ_file_named_untitled() {
        let workspace = workspace();

        let note = new_note(&workspace, NoteFormat::Typst);

        assert_eq!(note, "Untitled.typ");
        assert!(workspace.path().join("Untitled.typ").is_file());
    }

    #[test]
    fn a_markdown_note_is_an_md_file_named_untitled() {
        let workspace = workspace();

        let note = new_note(&workspace, NoteFormat::Markdown);

        assert_eq!(note, "Untitled.md");
        assert!(workspace.path().join("Untitled.md").is_file());
    }

    #[test]
    fn a_new_note_starts_empty() {
        let workspace = workspace();

        let note = new_note(&workspace, NoteFormat::Typst);

        assert_eq!(fs::read_to_string(workspace.path().join(note)).unwrap(), "");
    }

    #[test]
    fn a_new_note_is_created_at_the_top_of_the_workspace_even_if_it_has_folders() {
        let workspace = workspace();
        fs::create_dir(workspace.path().join("Papers")).unwrap();

        let note = new_note(&workspace, NoteFormat::Typst);

        assert!(!note.contains('/'));
    }

    #[test]
    fn a_new_note_shows_up_in_the_file_list() {
        let workspace = workspace();

        let note = new_note(&workspace, NoteFormat::Typst);

        let files = list_files(workspace.path()).unwrap();
        assert!(files.iter().any(|f| f.path == note));
    }
}

mod naming_new_notes {
    use super::*;

    #[test]
    fn an_existing_untitled_note_is_never_overwritten() {
        let workspace = workspace();
        fs::write(workspace.path().join("Untitled.typ"), "my thoughts").unwrap();

        let note = new_note(&workspace, NoteFormat::Typst);

        assert_eq!(note, "Untitled 2.typ");
        let existing = fs::read_to_string(workspace.path().join("Untitled.typ")).unwrap();
        assert_eq!(existing, "my thoughts");
    }

    #[test]
    fn untitled_notes_are_numbered_in_order() {
        let workspace = workspace();

        let notes: Vec<String> = (0..3).map(|_| new_note(&workspace, NoteFormat::Typst)).collect();

        assert_eq!(notes, ["Untitled.typ", "Untitled 2.typ", "Untitled 3.typ"]);
    }

    /// So a link to "Untitled" always points to exactly one note.
    #[test]
    fn a_note_never_shares_its_name_with_a_note_in_the_other_format() {
        let workspace = workspace();
        new_note(&workspace, NoteFormat::Markdown);

        let note = new_note(&workspace, NoteFormat::Typst);

        assert_eq!(note, "Untitled 2.typ");
    }
}

/// Clicking a link to a note that doesn't exist yet creates it, like in Obsidian.
mod creating_a_linked_note {
    use super::*;

    #[test]
    fn creates_an_empty_note_at_the_links_path() {
        let workspace = workspace();

        let created = create_note_at(workspace.path(), "Reading list.typ").unwrap();

        assert_eq!(created, "Reading list.typ");
        assert_eq!(fs::read_to_string(workspace.path().join("Reading list.typ")).unwrap(), "");
    }

    #[test]
    fn creates_the_folders_it_needs() {
        let workspace = workspace();

        create_note_at(workspace.path(), "Papers/2024/Attention.md").unwrap();

        assert!(workspace.path().join("Papers/2024/Attention.md").is_file());
    }

    #[test]
    fn a_note_that_exists_by_then_is_left_as_it_is() {
        let workspace = workspace();
        fs::write(workspace.path().join("Ideas.md"), "Kept.").unwrap();

        assert_eq!(create_note_at(workspace.path(), "Ideas.md").unwrap(), "Ideas.md");
        assert_eq!(fs::read_to_string(workspace.path().join("Ideas.md")).unwrap(), "Kept.");
    }

    #[test]
    fn only_makes_notes() {
        let workspace = workspace();

        assert!(create_note_at(workspace.path(), "picture.png").is_err());
        assert!(!workspace.path().join("picture.png").exists());
    }

    #[test]
    fn never_writes_outside_the_workspace() {
        let workspace = workspace();

        assert!(create_note_at(workspace.path(), "../Escaped.typ").is_err());
        assert!(!workspace.path().parent().unwrap().join("Escaped.typ").exists());
    }
}
