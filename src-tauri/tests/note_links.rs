//! Spec: the links between the workspace's notes, for the graph view. A link is a plain link to a
//! note's file, written from the note's own folder: `#link("Ideas.md")[…]` in Typst, `[…](Ideas.md)`
//! in Markdown (with %20 for spaces). Links to notes that don't exist yet count too.

use marginalia_lib::links::*;
use marginalia_lib::workspace::open_folder;
use std::fs;
use tempfile::TempDir;

fn workspace_with(notes: &[(&str, &str)]) -> TempDir {
    let folder = TempDir::new().unwrap();
    open_folder(folder.path()).unwrap();
    for (path, text) in notes {
        let path = folder.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    folder
}

fn links(workspace: &TempDir) -> Vec<(String, String)> {
    let mut found: Vec<_> = note_links(workspace.path()).into_iter().map(|l| (l.from, l.to)).collect();
    found.sort();
    found
}

fn pair(from: &str, to: &str) -> (String, String) {
    (from.to_string(), to.to_string())
}

mod finding_links_between_notes {
    use super::*;

    #[test]
    fn finds_typst_and_markdown_links() {
        let workspace = workspace_with(&[
            ("Paper.typ", "See #link(\"Ideas.md\")[my ideas]."),
            ("Ideas.md", "Back to [the paper](Paper.typ)."),
        ]);

        assert_eq!(links(&workspace), vec![pair("Ideas.md", "Paper.typ"), pair("Paper.typ", "Ideas.md")]);
    }

    #[test]
    fn follows_paths_from_the_notes_folder() {
        let workspace = workspace_with(&[
            ("Papers/Attention.typ", "#link(\"../Ideas.md\")[ideas] and #link(\"BERT.typ\")[BERT]"),
            ("Ideas.md", ""),
        ]);

        assert_eq!(links(&workspace), vec![pair("Papers/Attention.typ", "Ideas.md"), pair("Papers/Attention.typ", "Papers/BERT.typ")]);
    }

    #[test]
    fn reads_percent_20_as_a_space_in_markdown() {
        let workspace = workspace_with(&[("Ideas.md", "[list](Reading%20list.typ)")]);

        assert_eq!(links(&workspace), vec![pair("Ideas.md", "Reading list.typ")]);
    }

    #[test]
    fn links_to_notes_that_dont_exist_yet_count_too() {
        let workspace = workspace_with(&[("Paper.typ", "#link(\"Methods.typ\")[Methods]")]);

        assert_eq!(links(&workspace), vec![pair("Paper.typ", "Methods.typ")]);
    }

    #[test]
    fn websites_other_files_and_places_in_the_same_note_dont() {
        let workspace = workspace_with(&[(
            "Paper.typ",
            "#link(\"https://typst.app\")[Typst] #link(\"paper.pdf\")[PDF] #link(<intro>)[Intro] #link(\"../../Outside.typ\")[x]",
        )]);

        assert!(links(&workspace).is_empty());
    }

    #[test]
    fn several_links_to_the_same_note_are_one() {
        let workspace = workspace_with(&[("Paper.typ", "#link(\"Ideas.md\")[a] #link(\"Ideas.md\")[b]"), ("Ideas.md", "")]);

        assert_eq!(links(&workspace), vec![pair("Paper.typ", "Ideas.md")]);
    }

    #[test]
    fn a_link_to_a_part_of_a_note_links_to_the_note() {
        let workspace = workspace_with(&[
            ("Paper.typ", "#link(\"Ideas.md#methods\")[Ideas]"),
            ("Notes.md", "[Paper](Paper.typ#p-3f9a)"),
            ("Ideas.md", ""),
        ]);

        assert_eq!(links(&workspace), vec![pair("Notes.md", "Paper.typ"), pair("Paper.typ", "Ideas.md")]);
    }

    #[test]
    fn links_in_code_blocks_dont_count() {
        let workspace = workspace_with(&[("Ideas.md", "```\n[x](Paper.typ)\n```"), ("Paper.typ", "")]);

        assert!(links(&workspace).is_empty());
    }

    #[test]
    fn a_link_to_itself_doesnt_count() {
        let workspace = workspace_with(&[("Paper.typ", "#link(\"Paper.typ\")[here]")]);

        assert!(links(&workspace).is_empty());
    }
}
