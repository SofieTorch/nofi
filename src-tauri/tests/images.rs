//! Spec: images in notes. Pasted (or dropped) images are saved in the workspace's `assets` folder;
//! a note shows them with Typst's `#image("…")`, the path starting from the note's own folder.
//! Typst can read the workspace's files for that, and nothing outside the workspace.

use marginalia_lib::assets::*;
use marginalia_lib::pages::render_pages_at;
use marginalia_lib::problems::check_note_at;
use marginalia_lib::workspace::open_folder;
use std::fs;
use tempfile::TempDir;

/// A 1×1 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99, 0x3D, 0x1D, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

fn workspace() -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    folder
}

mod saving_a_pasted_image {
    use super::*;

    #[test]
    fn goes_in_the_assets_folder_which_is_made_if_needed() {
        let workspace = workspace();

        let saved = save_asset(workspace.path(), "pasted-image.png", PNG).unwrap();

        assert_eq!(saved, "assets/pasted-image.png");
        assert_eq!(fs::read(workspace.path().join("assets/pasted-image.png")).unwrap(), PNG);
    }

    #[test]
    fn never_overwrites_an_image_with_the_same_name() {
        let workspace = workspace();
        save_asset(workspace.path(), "pasted-image.png", PNG).unwrap();

        assert_eq!(save_asset(workspace.path(), "pasted-image.png", PNG).unwrap(), "assets/pasted-image 2.png");
    }

    #[test]
    fn only_images_are_saved_this_way() {
        let workspace = workspace();

        assert!(save_asset(workspace.path(), "script.sh", b"rm -rf").is_err());
    }

    #[test]
    fn a_name_cant_reach_outside_the_assets_folder() {
        let workspace = workspace();

        let saved = save_asset(workspace.path(), "../../escape.png", PNG).unwrap();

        assert_eq!(saved, "assets/escape.png");
    }
}

mod reading_workspace_files {
    use super::*;

    #[test]
    fn reads_a_file_in_the_workspace() {
        let workspace = workspace();
        fs::create_dir_all(workspace.path().join("assets")).unwrap();
        fs::write(workspace.path().join("assets/a.png"), PNG).unwrap();

        assert_eq!(read_workspace_file(workspace.path(), "assets/a.png").unwrap(), PNG);
    }

    #[test]
    fn never_reads_outside_it() {
        let workspace = workspace();

        assert!(read_workspace_file(workspace.path(), "../secret.txt").is_err());
    }
}

mod typst_and_images {
    use super::*;

    fn with_image() -> TempDir {
        let workspace = workspace();
        fs::create_dir_all(workspace.path().join("assets")).unwrap();
        fs::write(workspace.path().join("assets/a.png"), PNG).unwrap();
        workspace
    }

    #[test]
    fn a_note_with_an_image_from_the_workspace_has_no_mistakes() {
        let workspace = with_image();

        assert_eq!(check_note_at("#image(\"assets/a.png\", width: 50%)", workspace.path(), "Paper.typ"), vec![]);
    }

    #[test]
    fn paths_start_from_the_notes_folder() {
        let workspace = with_image();

        assert_eq!(check_note_at("#image(\"../assets/a.png\")", workspace.path(), "Papers/Attention.typ"), vec![]);
    }

    #[test]
    fn the_note_is_drawn_with_its_image() {
        let workspace = with_image();

        assert!(render_pages_at("#image(\"assets/a.png\")", workspace.path(), "Paper.typ").is_ok());
    }

    #[test]
    fn the_note_is_exported_as_a_pdf_with_its_image() {
        let workspace = with_image();

        let pdf = render_pages_at("#image(\"assets/a.png\")", workspace.path(), "Paper.typ").unwrap().pdf().unwrap();

        assert!(String::from_utf8_lossy(&pdf).replace(' ', "").contains("/Subtype/Image"));
    }

    #[test]
    fn a_missing_image_is_explained() {
        let workspace = workspace();

        let problems = check_note_at("#image(\"assets/nope.png\")", workspace.path(), "Paper.typ");

        assert_eq!(problems.len(), 1);
        assert!(problems[0].message.to_lowercase().contains("not found"), "{}", problems[0].message);
    }

    #[test]
    fn nothing_outside_the_workspace_can_be_read() {
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("secret.png"), PNG).unwrap();
        let workspace = workspace();
        let sneaky = format!("../../../../../../../../{}/secret.png", outside.path().display());

        assert_eq!(check_note_at(&format!("#image(\"{sneaky}\")"), workspace.path(), "Paper.typ").len(), 1);
    }
}
