//! Spec: searching the text inside the workspace's notes (from the ⌘P search bar). Each line
//! with what was typed is a match: which note, where (the line, and the column counted like the
//! editor counts), and a preview of the line to show.

use marginalia_lib::search::*;
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

fn search(workspace: &TempDir, query: &str) -> Vec<TextMatch> {
    search_notes(workspace.path(), query)
}

fn places(matches: &[TextMatch]) -> Vec<(String, usize, usize)> {
    matches.iter().map(|m| (m.path.clone(), m.line, m.column)).collect()
}

mod finding_text_in_notes {
    use super::*;

    #[test]
    fn finds_each_line_with_the_text_in_every_note() {
        let workspace = workspace_with(&[
            ("Paper.typ", "= Intro\n\nAttention is all you need.\n\nMore on attention here."),
            ("Ideas.md", "# Ideas\n\nTry attention."),
            ("Other.typ", "Nothing to see."),
        ]);

        let found = search(&workspace, "attention");

        assert_eq!(
            places(&found),
            vec![
                ("Ideas.md".to_string(), 3, 4),
                ("Paper.typ".to_string(), 3, 0),
                ("Paper.typ".to_string(), 5, 8),
            ]
        );
    }

    #[test]
    fn ignores_upper_and_lower_case() {
        let workspace = workspace_with(&[("Paper.typ", "ATTENTION please")]);

        assert_eq!(places(&search(&workspace, "Attention")), vec![("Paper.typ".to_string(), 1, 0)]);
    }

    #[test]
    fn says_how_long_the_match_is() {
        let workspace = workspace_with(&[("Paper.typ", "Some words")]);

        assert_eq!(search(&workspace, "words")[0].length, 5);
    }

    /// The editor counts in UTF-16, so an emoji (two units) before the match moves it by two.
    #[test]
    fn counts_columns_like_the_editor() {
        let workspace = workspace_with(&[("Paper.typ", "🙂 é word")]);

        let found = search(&workspace, "word");

        assert_eq!(found[0].column, 5);
    }

    #[test]
    fn looks_in_folders_but_not_in_hidden_ones_or_other_kinds_of_files() {
        let workspace = workspace_with(&[
            ("Papers/Attention.typ", "needle"),
            (".marginalia/cache.typ", "needle"),
            ("notes.txt", "needle"),
        ]);

        assert_eq!(places(&search(&workspace, "needle")), vec![("Papers/Attention.typ".to_string(), 1, 0)]);
    }

    #[test]
    fn nothing_typed_finds_nothing() {
        let workspace = workspace_with(&[("Paper.typ", "Some text")]);

        assert!(search(&workspace, "  ").is_empty());
    }

    #[test]
    fn stops_after_enough_matches() {
        let text = "word\n".repeat(MAX_MATCHES + 50);
        let workspace = workspace_with(&[("Paper.typ", &text)]);

        assert_eq!(search(&workspace, "word").len(), MAX_MATCHES);
    }
}

mod previews {
    use super::*;

    #[test]
    fn show_the_line_without_its_indentation() {
        let workspace = workspace_with(&[("Paper.typ", "    - an indented item")]);

        let found = &search(&workspace, "item")[0];

        assert_eq!(found.preview, "- an indented item");
        assert_eq!(found.preview_column, 14);
        assert_eq!(found.column, 18);
    }

    #[test]
    fn a_long_line_is_shortened_around_the_match() {
        let line = format!("{}needle{}", "a".repeat(200), "b".repeat(200));
        let workspace = workspace_with(&[("Paper.typ", &line)]);

        let found = &search(&workspace, "needle")[0];

        assert!(found.preview.chars().count() < 120, "{}", found.preview);
        assert!(found.preview.starts_with('…') && found.preview.ends_with('…'));
        let at: String = found.preview.chars().skip(found.preview_column).take(6).collect();
        assert_eq!(at, "needle");
    }
}
