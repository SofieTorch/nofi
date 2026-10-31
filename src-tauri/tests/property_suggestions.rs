//! Spec: suggestions for the properties table. There are no fixed fields, so names and values are
//! suggested from what the workspace's notes already use, plus a few common names to start with.

use marginalia_lib::properties::suggest_properties;
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

/// The suggested names, without the common ones every workspace gets.
fn used_names(workspace: &TempDir) -> Vec<String> {
    suggest_properties(workspace.path())
        .into_iter()
        .filter(|p| p.notes > 0)
        .map(|p| p.key)
        .collect()
}

fn suggestion(workspace: &TempDir, key: &str) -> marginalia_lib::properties::KnownProperty {
    suggest_properties(workspace.path()).into_iter().find(|p| p.key == key).unwrap()
}

mod names {
    use super::*;

    #[test]
    fn suggests_the_names_used_in_the_workspaces_notes_most_used_first() {
        let workspace = workspace_with(&[
            ("A.md", "---\nyear: 2017\nvenue: NeurIPS\n---"),
            ("B.md", "---\nyear: 2018\n---"),
            ("C.md", "---\nyear: 2019\nread: true\n---"),
            ("D.md", "---\nvenue: ICML\n---"),
        ]);

        assert_eq!(used_names(&workspace), ["year", "venue", "read"]);
        assert_eq!(suggestion(&workspace, "year").notes, 3);
    }

    #[test]
    fn reads_markdown_and_typst_notes_also_in_folders() {
        let workspace = workspace_with(&[
            ("A.md", "---\nyear: 2017\n---"),
            ("Papers/B.typ", "#metadata((venue: \"ICML\")) <properties>"),
        ]);

        let mut names = used_names(&workspace);
        names.sort();
        assert_eq!(names, ["venue", "year"]);
    }

    #[test]
    fn each_name_comes_with_the_type_it_usually_has() {
        let workspace = workspace_with(&[
            ("A.md", "---\nyear: 2017\nauthors: [Vaswani]\nread: true\npublished: 2017-06-12\n---"),
            ("B.md", "---\nyear: 2018\n---"),
            ("C.md", "---\nyear: unknown\n---"),
        ]);

        assert_eq!(suggestion(&workspace, "year").kind, "number");
        assert_eq!(suggestion(&workspace, "authors").kind, "list");
        assert_eq!(suggestion(&workspace, "read").kind, "boolean");
        assert_eq!(suggestion(&workspace, "published").kind, "date");
    }

    #[test]
    fn common_names_are_suggested_even_in_a_new_workspace() {
        let workspace = workspace_with(&[]);

        let common: Vec<(String, String)> =
            suggest_properties(workspace.path()).into_iter().map(|p| (p.key, p.kind)).collect();

        for (key, kind) in [("tags", "list"), ("authors", "list"), ("date", "date"), ("status", "text"), ("title", "text")] {
            assert!(common.contains(&(key.into(), kind.into())), "missing {key}: {common:?}");
        }
    }

    #[test]
    fn a_common_name_already_used_isnt_suggested_twice() {
        let workspace = workspace_with(&[("A.md", "---\ntags: [ml]\n---")]);

        let tags = suggest_properties(workspace.path()).into_iter().filter(|p| p.key == "tags").count();

        assert_eq!(tags, 1);
    }

    #[test]
    fn notes_with_a_mistake_in_their_properties_are_skipped() {
        let workspace = workspace_with(&[("A.md", "---\ntags: [ml\n---"), ("B.md", "---\nyear: 2017\n---")]);

        assert_eq!(used_names(&workspace), ["year"]);
    }

    #[test]
    fn hidden_folders_and_other_files_are_ignored() {
        let workspace = workspace_with(&[
            (".trash/A.md", "---\nsecret: 1\n---"),
            ("notes.txt", "---\nplain: 1\n---"),
            ("B.md", "---\nyear: 2017\n---"),
        ]);

        assert_eq!(used_names(&workspace), ["year"]);
    }
}

mod values {
    use super::*;

    #[test]
    fn suggests_the_values_a_property_has_in_other_notes_most_used_first() {
        let workspace = workspace_with(&[
            ("A.md", "---\nstatus: reading\n---"),
            ("B.md", "---\nstatus: done\n---"),
            ("C.md", "---\nstatus: done\n---"),
        ]);

        assert_eq!(suggestion(&workspace, "status").values, ["done", "reading"]);
    }

    #[test]
    fn suggests_each_item_of_lists_on_its_own() {
        let workspace = workspace_with(&[
            ("A.md", "---\ntags: [ml, attention]\n---"),
            ("B.typ", "#metadata((tags: (\"ml\", \"vision\"))) <properties>"),
        ]);

        assert_eq!(suggestion(&workspace, "tags").values, ["ml", "attention", "vision"]);
    }

    #[test]
    fn numbers_dates_and_empty_values_arent_suggested() {
        let workspace = workspace_with(&[("A.md", "---\nyear: 2017\nwhen: 2017-06-12\nnote:\n---")]);

        assert!(suggestion(&workspace, "year").values.is_empty());
        assert!(suggestion(&workspace, "when").values.is_empty());
        assert!(suggestion(&workspace, "note").values.is_empty());
    }
}
