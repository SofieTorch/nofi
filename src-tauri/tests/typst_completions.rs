//! Spec: suggestions while writing Typst, from Typst's own editor helpers. In `#set page(` they
//! offer what a page can be set to; after `paper: ` the paper sizes; in maths, symbols; and so on.
//! Positions are counted the way the editor counts characters.

use marginalia_lib::completions::{complete, Suggestion, Suggestions};

/// Suggestions with the cursor at `|`.
fn at_cursor(text_with_cursor: &str, explicit: bool) -> Option<Suggestions> {
    let cursor = text_with_cursor.split_once('|').unwrap().0.encode_utf16().count();
    complete(&text_with_cursor.replace('|', ""), cursor, explicit)
}

fn labels(text_with_cursor: &str) -> Vec<String> {
    at_cursor(text_with_cursor, false).map(|s| s.items.into_iter().map(|i| i.label).collect()).unwrap_or_default()
}

fn suggestion(text_with_cursor: &str, label: &str) -> Suggestion {
    at_cursor(text_with_cursor, false)
        .unwrap()
        .items
        .into_iter()
        .find(|item| item.label == label)
        .unwrap_or_else(|| panic!("no suggestion {label:?}"))
}

mod what_is_suggested {
    use super::*;

    #[test]
    fn inside_set_page_it_offers_what_a_page_can_be_set_to() {
        let labels = labels("#set page(|)");

        for setting in ["width", "height", "columns", "margin", "flipped", "numbering"] {
            assert!(labels.contains(&setting.to_string()), "missing {setting}: {labels:?}");
        }
    }

    #[test]
    fn inside_set_text_it_offers_what_text_can_be_set_to() {
        let labels = labels("#set text(|)");

        for setting in ["font", "size", "lang"] {
            assert!(labels.contains(&setting.to_string()), "missing {setting}: {labels:?}");
        }
    }

    #[test]
    fn after_a_setting_it_offers_its_possible_values() {
        let papers = labels("#set page(paper: |)");

        assert!(papers.contains(&"\"a4\"".to_string()), "{papers:?}");
        assert!(papers.contains(&"\"us-letter\"".to_string()), "{papers:?}");
    }

    #[test]
    fn fonts_are_offered_for_the_font_setting() {
        let fonts = labels("#set text(font: |)");

        assert!(fonts.iter().any(|font| font.contains("Libertinus Serif")), "{fonts:?}");
    }

    #[test]
    fn after_a_hash_it_offers_typsts_functions_and_keywords() {
        let labels = labels("#|");

        for name in ["set rule", "let binding", "page", "text", "image"] {
            assert!(labels.contains(&name.to_string()), "missing {name}");
        }
    }

    #[test]
    fn in_maths_it_offers_symbols() {
        let labels = labels("$alp|$");

        assert!(labels.contains(&"alpha".to_string()), "{labels:?}");
    }

    #[test]
    fn plain_text_gets_no_suggestions_unless_asked_for() {
        assert!(at_cursor("Some plain te|xt", false).is_none());
    }

    /// Typst's descriptions can have line breaks in them (like "841.0\n×\n1189.0").
    #[test]
    fn descriptions_are_one_line_of_text() {
        let a4 = suggestion("#set page(paper: |)", "\"a4\"");

        assert_eq!(a4.detail.as_deref(), Some("A paper that is 210.0 × 297.0 millimeters in size."));
    }

    #[test]
    fn suggestions_have_a_short_description() {
        let columns = suggestion("#set page(|)", "columns");

        assert!(columns.detail.as_deref().is_some_and(|d| !d.is_empty()));
    }
}

mod using_a_suggestion {
    use super::*;

    #[test]
    fn says_which_part_of_the_text_it_replaces() {
        let suggestions = at_cursor("#set page(pap|)", false).unwrap();

        assert_eq!(suggestions.from, "#set page(".len());
    }

    /// Typst describes insertions with placeholders like `columns: ${}`: the cursor goes there.
    #[test]
    fn puts_the_cursor_where_the_value_goes() {
        let columns = suggestion("#set page(|)", "columns");

        assert_eq!(columns.insert, "columns: ");
        assert_eq!((columns.cursor, columns.selection), ("columns: ".len(), 0));
    }

    /// `let ${name} = ${value}` becomes `let name = value`, with "name" selected to type over.
    #[test]
    fn named_placeholders_are_kept_as_text_and_the_first_is_selected() {
        let binding = suggestion("#|", "let binding");

        assert_eq!(binding.insert, "let name = value");
        assert_eq!((binding.cursor, binding.selection), ("let ".len(), "name".len()));
    }

    #[test]
    fn positions_count_characters_the_way_the_editor_does() {
        let suggestions = at_cursor("Café ☕ #set page(pap|)", false).unwrap();

        assert_eq!(suggestions.from, "Café ☕ #set page(".encode_utf16().count());
    }
}
