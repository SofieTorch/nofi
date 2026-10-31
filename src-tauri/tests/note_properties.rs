//! Spec: a note's properties (information about it, like authors, year or tags), with no fixed
//! fields: any name, and the type comes from the value. Markdown notes keep them in the standard
//! `---` frontmatter; Typst notes in `#metadata((…)) <properties>`, which Typst itself can read.

use marginalia_lib::notes::NoteFormat::{self, Markdown, Typst};
use marginalia_lib::properties::*;

fn text(value: &str) -> Value {
    Value::Text(value.into())
}

fn list(items: &[&str]) -> Value {
    Value::List(items.iter().map(|item| item.to_string()).collect())
}

/// The block's properties as (name, value) pairs.
fn read(format: NoteFormat, block: &str) -> Vec<(String, Value)> {
    parse_block(block, format).unwrap().into_iter().map(|p| (p.key, p.value)).collect()
}

/// A property as the user edits it (no original text to keep).
fn edited(key: &str, value: Value) -> Property {
    Property { key: key.into(), value, raw: None }
}

/// Reads a block, applies `change` to its properties, and writes it back.
fn change(format: NoteFormat, block: &str, change: impl FnOnce(&mut Vec<Property>)) -> String {
    let mut properties = parse_block(block, format).unwrap();
    change(&mut properties);
    write_block(&properties, format)
}

fn all_kinds_of_values() -> Vec<Property> {
    vec![
        edited("title", text("Attention Is All You Need")),
        edited("year", Value::Number(2017.0)),
        edited("score", Value::Number(4.5)),
        edited("read", Value::Bool(true)),
        edited("published", Value::Date("2017-06-12".into())),
        edited("authors", list(&["Vaswani", "Shazeer"])),
    ]
}

mod finding_the_properties_block {
    use super::*;

    #[test]
    fn in_markdown_it_is_the_dashes_block_at_the_very_top() {
        let note = "---\nyear: 2017\n---\n# Notes";

        assert_eq!(find_block(note, Markdown), Some(0.."---\nyear: 2017\n---".len()));
    }

    #[test]
    fn in_typst_it_is_the_metadata_labelled_properties_at_the_very_top() {
        let note = "#metadata((year: 2017)) <properties>\n= Notes";

        assert_eq!(find_block(note, Typst), Some(0.."#metadata((year: 2017)) <properties>".len()));
    }

    #[test]
    fn a_block_further_down_isnt_the_notes_properties() {
        assert_eq!(find_block("# Notes\n---\nyear: 2017\n---", Markdown), None);
        assert_eq!(find_block("= Notes\n#metadata((year: 2017)) <properties>", Typst), None);
    }

    #[test]
    fn other_metadata_isnt_the_notes_properties() {
        assert_eq!(find_block("#metadata((year: 2017)) <other>", Typst), None);
        assert_eq!(find_block("#metadata((year: 2017))", Typst), None);
    }

    #[test]
    fn an_unclosed_block_isnt_properties() {
        assert_eq!(find_block("---\nyear: 2017\n# Notes", Markdown), None);
    }

    #[test]
    fn a_note_without_properties_has_no_block() {
        assert_eq!(find_block("Just text", Markdown), None);
        assert_eq!(find_block("Just text", Typst), None);
    }
}

mod reading_properties {
    use super::*;

    #[test]
    fn markdown_values_get_their_type_from_how_they_are_written() {
        let block = "---\ntitle: Attention Is All You Need\nyear: 2017\nscore: 4.5\nread: true\npublished: 2017-06-12\nauthors: [Vaswani, Shazeer]\n---";

        let expected: Vec<(String, Value)> =
            all_kinds_of_values().into_iter().map(|p| (p.key, p.value)).collect();
        assert_eq!(read(Markdown, block), expected);
    }

    #[test]
    fn typst_values_get_their_type_from_how_they_are_written() {
        let block = r#"#metadata((
  title: "Attention Is All You Need",
  year: 2017,
  score: 4.5,
  read: true,
  published: datetime(year: 2017, month: 6, day: 12),
  authors: ("Vaswani", "Shazeer"),
)) <properties>"#;

        let expected: Vec<(String, Value)> =
            all_kinds_of_values().into_iter().map(|p| (p.key, p.value)).collect();
        assert_eq!(read(Typst, block), expected);
    }

    #[test]
    fn markdown_lists_can_also_be_written_one_item_per_line() {
        let block = "---\ntags:\n  - ml\n  - attention\n---";

        assert_eq!(read(Markdown, block), [("tags".into(), list(&["ml", "attention"]))]);
    }

    #[test]
    fn names_can_have_spaces() {
        assert_eq!(read(Markdown, "---\nfirst author: Vaswani\n---")[0].0, "first author");
        assert_eq!(read(Typst, "#metadata((\"first author\": \"Vaswani\")) <properties>")[0].0, "first author");
    }

    #[test]
    fn an_empty_value_is_empty_text() {
        assert_eq!(read(Markdown, "---\nstatus:\n---"), [("status".into(), text(""))]);
    }

    #[test]
    fn quoted_values_stay_text_even_if_they_look_like_something_else() {
        let block = "---\nyear: \"2017\"\nread: \"yes\"\nwhen: \"2017-06-12\"\n---";

        assert_eq!(
            read(Markdown, block),
            [("year".into(), text("2017")), ("read".into(), text("yes")), ("when".into(), text("2017-06-12"))]
        );
    }

    /// Anything else (like a nested group) is kept exactly as written; it can be edited as text.
    #[test]
    fn values_that_cant_be_edited_in_the_table_are_kept_as_written() {
        let markdown = parse_block("---\nvenue:\n  name: NeurIPS\n  city: Long Beach\n---", Markdown).unwrap();
        let typst = parse_block("#metadata((venue: (name: \"NeurIPS\"))) <properties>", Typst).unwrap();

        assert_eq!(markdown[0].value, Value::Other);
        assert_eq!(markdown[0].raw.as_deref(), Some("venue:\n  name: NeurIPS\n  city: Long Beach"));
        assert_eq!(typst[0].value, Value::Other);
        assert_eq!(typst[0].raw.as_deref(), Some("venue: (name: \"NeurIPS\")"));
    }

    #[test]
    fn keeps_the_order_they_are_written_in() {
        let names: Vec<String> =
            read(Markdown, "---\nzebra: 1\napple: 2\nmango: 3\n---").into_iter().map(|(k, _)| k).collect();

        assert_eq!(names, ["zebra", "apple", "mango"]);
    }

    #[test]
    fn a_block_with_a_mistake_is_explained() {
        assert!(parse_block("---\ntags: [ml\n---", Markdown).is_err());
        assert!(parse_block("#metadata((year: )) <properties>", Typst).is_err());
    }
}

mod writing_properties {
    use super::*;

    #[test]
    fn markdown_properties_are_written_as_frontmatter() {
        assert_eq!(
            write_block(&all_kinds_of_values(), Markdown),
            "---\ntitle: Attention Is All You Need\nyear: 2017\nscore: 4.5\nread: true\npublished: 2017-06-12\nauthors: [Vaswani, Shazeer]\n---"
        );
    }

    #[test]
    fn typst_properties_are_written_as_metadata() {
        assert_eq!(
            write_block(&all_kinds_of_values(), Typst),
            r#"#metadata((
  title: "Attention Is All You Need",
  year: 2017,
  score: 4.5,
  read: true,
  published: datetime(year: 2017, month: 6, day: 12),
  authors: ("Vaswani", "Shazeer"),
)) <properties>"#
        );
    }

    #[test]
    fn what_is_written_reads_back_the_same() {
        for format in [Markdown, Typst] {
            let written = write_block(&all_kinds_of_values(), format);
            let expected: Vec<(String, Value)> =
                all_kinds_of_values().into_iter().map(|p| (p.key, p.value)).collect();
            assert_eq!(read(format, &written), expected, "{format:?}");
        }
    }

    /// Text like "yes", "2017" or "a: b" is quoted, so it reads back as text.
    #[test]
    fn text_that_looks_like_something_else_stays_text() {
        let tricky = ["yes", "2017", "a: b", "#hashtag", "", " padded ", "[not a list]", "say \"hi\"", "line\nbreak"];
        for format in [Markdown, Typst] {
            let properties: Vec<Property> = tricky.iter().map(|t| edited("note", text(t))).collect();
            for (property, original) in properties.iter().zip(tricky) {
                let written = write_block(std::slice::from_ref(property), format);
                assert_eq!(read(format, &written), [("note".into(), text(original))], "{format:?}: {written}");
            }
        }
    }

    #[test]
    fn a_one_item_list_stays_a_list_in_typst() {
        let written = write_block(&[edited("tags", list(&["ml"]))], Typst);

        assert!(written.contains("(\"ml\",)"), "{written}");
        assert_eq!(read(Typst, &written), [("tags".into(), list(&["ml"]))]);
    }

    #[test]
    fn names_that_arent_plain_words_are_quoted_in_typst() {
        let written = write_block(&[edited("first author", text("Vaswani")), edited("if", text("x"))], Typst);

        assert!(written.contains("\"first author\": \"Vaswani\""), "{written}");
        assert!(written.contains("\"if\": \"x\""), "{written}");
    }

    #[test]
    fn changing_one_property_leaves_the_others_exactly_as_written() {
        let block = "---\n# where I read it\nsource:   arXiv   # preprint\nyear: 2017\n---";

        let written = change(Markdown, block, |properties| {
            properties[1] = edited("year", Value::Number(2018.0));
        });

        assert_eq!(written, "---\n# where I read it\nsource:   arXiv   # preprint\nyear: 2018\n---");
    }

    #[test]
    fn changing_one_typst_property_leaves_the_others_exactly_as_written() {
        let block = "#metadata((authors: (\"A\",  \"B\"), year: 2017)) <properties>";

        let written = change(Typst, block, |properties| {
            properties[1] = edited("year", Value::Number(2018.0));
        });

        assert!(written.contains("authors: (\"A\",  \"B\")"), "{written}");
        assert!(written.contains("year: 2018"), "{written}");
    }

    #[test]
    fn adding_and_removing_properties() {
        let written = change(Markdown, "---\nyear: 2017\nread: false\n---", |properties| {
            properties.remove(0);
            properties.push(edited("status", text("draft")));
        });

        assert_eq!(written, "---\nread: false\nstatus: draft\n---");
    }

    /// With no properties left, the note goes back to having no block at all.
    #[test]
    fn removing_every_property_removes_the_block() {
        assert_eq!(write_block(&[], Markdown), "");
        assert_eq!(write_block(&[], Typst), "");
    }
}
