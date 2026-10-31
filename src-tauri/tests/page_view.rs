//! Spec: the page view, which shows a Typst note as real pages (like the PDF it would become)
//! next to the editor, and lets you click on a page to find that spot in the text.

use marginalia_lib::layout::{load_show_pages, load_explorer_layout, save_explorer_layout, save_show_pages, ExplorerLayout, Side};
use marginalia_lib::pages::render_pages;
use marginalia_lib::workspace::open_folder;
use tempfile::TempDir;

/// A small page without margins and with 10pt text, so positions on it are easy to predict.
const SMALL_PAGE: &str = "#set page(width: 200pt, height: auto, margin: 0pt)\n#set text(size: 10pt)\n";

mod drawing_pages {
    use super::*;

    #[test]
    fn a_short_note_is_one_page() {
        let pages = render_pages("= Ideas\nRead more papers.").unwrap().pictures();

        assert_eq!(pages.len(), 1);
        assert!(pages[0].svg.starts_with("<svg"));
    }

    /// Typst's default page is A4: 595 × 842 points.
    #[test]
    fn pages_are_a4_unless_the_note_says_otherwise() {
        let pages = render_pages("Hello").unwrap().pictures();

        assert_eq!((pages[0].width.round(), pages[0].height.round()), (595.0, 842.0));
    }

    #[test]
    fn page_settings_in_the_note_are_used() {
        let pages = render_pages("#set page(width: 300pt, height: 200pt)\nHello").unwrap().pictures();

        assert_eq!((pages[0].width, pages[0].height), (300.0, 200.0));
    }

    #[test]
    fn a_long_note_continues_on_more_pages() {
        let note = "Some words to fill the page. ".repeat(1000);

        let pages = render_pages(&note).unwrap().pictures();

        assert!(pages.len() > 1);
    }

    #[test]
    fn two_column_notes_are_laid_out_in_two_columns() {
        let one = render_pages("Some words. #colbreak() More words.").unwrap().pictures();
        let two = render_pages("#set page(columns: 2)\nSome words. #colbreak() More words.")
            .unwrap()
            .pictures();

        // In one column, a column break starts a new page; in two, the second column.
        assert_eq!(one.len(), 2);
        assert_eq!(two.len(), 1);
    }

    #[test]
    fn an_empty_note_is_one_blank_page() {
        assert_eq!(render_pages("").unwrap().pictures().len(), 1);
    }

    #[test]
    fn a_mistake_is_explained_with_its_line() {
        let error = render_pages("= Ideas\nSo $alpah$ holds.").unwrap_err();

        assert_eq!(error, "Line 2: Unknown variable: alpah.");
    }

    #[test]
    fn notes_cant_read_files_or_download_packages() {
        assert!(render_pages("#read(\"/etc/hosts\")").is_err());
        assert!(render_pages("#import \"@preview/cetz:0.4.0\": *").is_err());
    }
}

mod clicking_on_a_page {
    use super::*;

    #[test]
    fn finds_the_spot_in_the_text_that_was_clicked() {
        let note = format!("{SMALL_PAGE}First paragraph.\n\nSecond paragraph.");
        let pages = render_pages(&note).unwrap();

        let first = pages.position_at(0, 2.0, 5.0).unwrap();
        let second = pages.position_at(0, 2.0, 25.0).unwrap();

        let first_starts = note.find("First").unwrap();
        let second_starts = note.find("Second").unwrap();
        assert!((first_starts..first_starts + 3).contains(&first), "got {first}");
        assert!((second_starts..second_starts + 3).contains(&second), "got {second}");
    }

    #[test]
    fn clicking_where_there_is_no_text_finds_nothing() {
        let pages = render_pages("#set page(width: 200pt, height: 200pt, margin: 0pt)\nHi").unwrap();

        assert_eq!(pages.position_at(0, 150.0, 180.0), None);
    }

    #[test]
    fn clicking_outside_the_pages_finds_nothing() {
        let pages = render_pages("Hi").unwrap();

        assert_eq!(pages.position_at(5, 10.0, 10.0), None);
    }

    /// The editor counts "é" as one character, but a file stores it as two bytes.
    #[test]
    fn positions_count_characters_the_way_the_editor_does() {
        let note = format!("{SMALL_PAGE}Café.\n\nSecond paragraph.");
        let pages = render_pages(&note).unwrap();

        let second = pages.position_at(0, 2.0, 25.0).unwrap();

        let second_starts = note.chars().position(|c| c == 'S').unwrap();
        assert!((second_starts..second_starts + 3).contains(&second), "got {second}");
    }
}

mod remembering_the_page_view {
    use super::*;

    fn workspace() -> TempDir {
        let folder = TempDir::new().unwrap();
        open_folder(folder.path()).unwrap();
        folder
    }

    #[test]
    fn the_page_view_is_hidden_at_first() {
        assert!(!load_show_pages(workspace().path()));
    }

    #[test]
    fn showing_the_pages_is_remembered_for_the_workspace() {
        let workspace = workspace();

        save_show_pages(workspace.path(), true).unwrap();

        assert!(load_show_pages(workspace.path()));
    }

    #[test]
    fn the_page_view_and_the_explorer_layout_are_remembered_independently() {
        let workspace = workspace();
        let on_the_right = ExplorerLayout { side: Side::Right, ..Default::default() };

        save_explorer_layout(workspace.path(), &on_the_right).unwrap();
        save_show_pages(workspace.path(), true).unwrap();
        save_explorer_layout(workspace.path(), &on_the_right).unwrap();

        assert!(load_show_pages(workspace.path()));
        assert_eq!(load_explorer_layout(workspace.path()), on_the_right);
    }
}
