//! Spec: boards (whiteboards). A board is a file of its own, `Name.canvas`, in the JSON Canvas
//! format: cards (text written on the board, or a file, maybe a part of it) and arrows between
//! them. A new board starts empty (an empty file is an empty board). For the graph, a board links
//! to the notes it shows as cards, and to the notes its text cards link to.

use marginalia_lib::links::note_links;
use marginalia_lib::notes::create_board;
use marginalia_lib::workspace::open_folder;
use std::fs;
use tempfile::TempDir;

fn workspace_with(files: &[(&str, &str)]) -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    for (path, text) in files {
        let path = folder.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    folder
}

mod creating_a_board {
    use super::*;

    #[test]
    fn a_new_board_is_an_empty_untitled_canvas_file() {
        let workspace = workspace_with(&[]);

        let board = create_board(workspace.path()).unwrap();

        assert_eq!(board, "Untitled.canvas");
        assert_eq!(fs::read_to_string(workspace.path().join(board)).unwrap(), "");
    }

    #[test]
    fn its_name_is_never_one_taken_already() {
        let workspace = workspace_with(&[("Untitled.canvas", "")]);

        assert_eq!(create_board(workspace.path()).unwrap(), "Untitled 2.canvas");
    }
}

mod links_from_boards {
    use super::*;

    const BOARD: &str = r##"{
        "nodes": [
            {"id": "a", "type": "file", "file": "Papers/Attention.typ", "subpath": "#methods", "x": 0, "y": 0, "width": 300, "height": 200},
            {"id": "b", "type": "file", "file": "Papers/attention.pdf", "subpath": "#page=3", "x": 400, "y": 0, "width": 300, "height": 400},
            {"id": "c", "type": "text", "text": "See #link(\"../Ideas.md\")[ideas].", "x": 0, "y": 300, "width": 200, "height": 100}
        ],
        "edges": [{"id": "e", "fromNode": "a", "toNode": "b"}]
    }"##;

    #[test]
    fn a_board_links_to_the_notes_on_it_and_in_its_text() {
        let workspace = workspace_with(&[
            ("Boards/Transformers.canvas", BOARD),
            ("Papers/Attention.typ", ""),
            ("Ideas.md", ""),
        ]);

        let mut links: Vec<_> = note_links(workspace.path()).into_iter().map(|l| (l.from, l.to)).collect();
        links.sort();

        assert_eq!(
            links,
            vec![
                ("Boards/Transformers.canvas".to_string(), "Ideas.md".to_string()),
                ("Boards/Transformers.canvas".to_string(), "Papers/Attention.typ".to_string()),
            ]
        );
    }

    #[test]
    fn an_empty_or_broken_board_has_no_links() {
        let workspace = workspace_with(&[("A.canvas", ""), ("B.canvas", "{ not json")]);

        assert!(note_links(workspace.path()).is_empty());
    }
}
