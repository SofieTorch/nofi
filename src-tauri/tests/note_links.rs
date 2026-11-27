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

    #[test]
    fn finds_the_notes_that_link_to_a_pdf() {
        let workspace = workspace_with(&[
            ("Papers/attention notes.typ", "#link(\"attention.pdf#page=3&quote=All\")[p. 3]"),
            ("Ideas.md", "[paper](Papers/attention.pdf)"),
            ("Other.typ", "#link(\"Papers/other.pdf\")[other]"),
            ("Papers/attention.pdf", ""),
        ]);

        let mut found = notes_linking_to(workspace.path(), "Papers/attention.pdf");
        found.sort();

        assert_eq!(found, vec!["Ideas.md".to_string(), "Papers/attention notes.typ".to_string()]);
    }

    #[test]
    fn finds_the_notes_that_link_to_a_zotero_paper() {
        let workspace = workspace_with(&[
            ("gpt3 notes.typ", "#link(\"zotero:GPT30001#page=3&quote=All\")[p. 3]"),
            ("Ideas.md", "[paper](zotero:GPT30001)"),
            ("Group.typ", "#link(\"zotero:groups/77/UNIPAPER#page=1&point=10,20\")[p. 1]"),
            ("Other.typ", "#link(\"zotero:BERT2018\")[other]"),
        ]);

        let mut found = notes_linking_to(workspace.path(), "zotero:GPT30001");
        found.sort();

        assert_eq!(found, vec!["Ideas.md".to_string(), "gpt3 notes.typ".to_string()]);
        assert_eq!(notes_linking_to(workspace.path(), "zotero:groups/77/UNIPAPER"), vec!["Group.typ".to_string()]);
    }

    #[test]
    fn a_note_whose_source_property_names_a_zotero_paper_links_to_it() {
        let workspace = workspace_with(&[("gpt3 notes.typ", "#metadata((\n  source: \"zotero:GPT30001\",\n)) <properties>\n\nNothing yet.")]);

        assert_eq!(notes_linking_to(workspace.path(), "zotero:GPT30001"), vec!["gpt3 notes.typ".to_string()]);
    }

    #[test]
    fn a_note_whose_source_property_names_a_pdf_links_to_it() {
        let workspace = workspace_with(&[
            ("Papers/attention notes.typ", "#metadata((\n  source: \"attention.pdf\",\n  year: 2017,\n)) <properties>\n\nNothing yet."),
            ("Reading.md", "---\nsource: Papers/attention.pdf\n---\nLater."),
            ("Other.typ", "#metadata((\n  title: \"attention.pdf\",\n)) <properties>"),
            ("Papers/attention.pdf", ""),
        ]);

        let mut found = notes_linking_to(workspace.path(), "Papers/attention.pdf");
        found.sort();

        assert_eq!(found, vec!["Papers/attention notes.typ".to_string(), "Reading.md".to_string()]);
    }

    #[test]
    fn a_source_property_naming_a_note_is_a_link_in_the_graph() {
        let workspace = workspace_with(&[
            ("Summary.typ", "#metadata((\n  source: \"Lecture.typ\",\n)) <properties>"),
            ("Lecture.typ", "Notes."),
        ]);

        assert_eq!(links(&workspace), vec![("Summary.typ".to_string(), "Lecture.typ".to_string())]);
    }
}

/// PDFs are in the graph like notes: notes link to them (or name one as their `source`), and a
/// PDF links to notes from its own words, with links kept in its annotations file beside it
/// (`{"type": "link", "to": "…"}`, the note's path from the PDF's folder).
mod pdfs_in_the_graph {
    use super::*;

    #[test]
    fn a_note_linking_to_a_pdf_in_the_workspace_links_to_it() {
        let workspace = workspace_with(&[
            ("Ideas.typ", "See #link(\"Papers/attention.pdf#page=3\")[the paper]."),
            ("Papers/attention notes.typ", "#metadata((\n  source: \"attention.pdf\",\n)) <properties>"),
            ("Papers/attention.pdf", ""),
        ]);

        assert_eq!(
            links(&workspace),
            vec![pair("Ideas.typ", "Papers/attention.pdf"), pair("Papers/attention notes.typ", "Papers/attention.pdf")]
        );
    }

    #[test]
    fn a_pdfs_links_to_notes_are_links_from_the_pdf() {
        let workspace = workspace_with(&[
            ("Papers/attention.pdf", ""),
            (
                "Papers/attention.annotations.json",
                r#"{"pdf": "attention.pdf", "annotations": [
                    {"id": "a", "type": "link", "page": 3, "quote": "batch inference", "to": "batch inference.typ"},
                    {"id": "b", "type": "link", "page": 4, "quote": "throughput", "to": "../Ideas.md"},
                    {"id": "c", "type": "highlight", "page": 1, "colour": "yellow", "quote": "Attention"}
                ]}"#,
            ),
            ("Papers/batch inference.typ", ""),
            ("Ideas.md", ""),
        ]);

        assert_eq!(
            links(&workspace),
            vec![pair("Papers/attention.pdf", "Ideas.md"), pair("Papers/attention.pdf", "Papers/batch inference.typ")]
        );
    }

    #[test]
    fn a_pdfs_link_to_a_note_not_created_yet_counts_too() {
        let workspace = workspace_with(&[
            ("attention.pdf", ""),
            ("attention.annotations.json", r#"{"annotations": [{"id": "a", "type": "link", "page": 1, "quote": "x", "to": "Later.typ"}]}"#),
        ]);

        assert_eq!(links(&workspace), vec![pair("attention.pdf", "Later.typ")]);
    }

    #[test]
    fn a_pdf_linking_to_another_pdf_in_the_workspace_links_to_it() {
        let workspace = workspace_with(&[
            ("Papers/attention.pdf", ""),
            ("Papers/bert.pdf", ""),
            (
                "Papers/attention.annotations.json",
                r#"{"annotations": [
                    {"id": "a", "type": "link", "page": 9, "quote": "[12]", "to": "bert.pdf"},
                    {"id": "b", "type": "link", "page": 9, "quote": "[13]", "to": "missing.pdf"},
                    {"id": "c", "type": "link", "page": 9, "quote": "[14]", "to": "zotero:ABC123"}
                ]}"#,
            ),
        ]);

        assert_eq!(links(&workspace), vec![pair("Papers/attention.pdf", "Papers/bert.pdf")]);
    }

    #[test]
    fn an_unreadable_annotations_file_has_no_links() {
        let workspace = workspace_with(&[("attention.pdf", ""), ("attention.annotations.json", "not json")]);

        assert!(links(&workspace).is_empty());
    }
}

/// Zotero papers' annotations are kept in the workspace's hidden folder (not in its files), so
/// their links can be found to change when notes move.
mod zotero_papers_with_annotations {
    use super::*;

    #[test]
    fn lists_the_papers_whose_annotations_are_kept_here() {
        let workspace = workspace_with(&[
            (".marginalia/zotero/ABC123.annotations.json", "{}"),
            (".marginalia/zotero/1_XYZ.annotations.json", "{}"),
            (".marginalia/zotero/notes.txt", ""),
        ]);

        let mut found = marginalia_lib::links::zotero_papers_with_annotations(workspace.path());
        found.sort();

        assert_eq!(found, vec!["1_XYZ".to_string(), "ABC123".to_string()]);
    }

    #[test]
    fn none_when_there_are_none() {
        let workspace = workspace_with(&[]);

        assert!(marginalia_lib::links::zotero_papers_with_annotations(workspace.path()).is_empty());
    }
}
