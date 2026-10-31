//! Spec: the "/" menu, which inserts blocks like headings, lists, maths, tables or columns.
//! Typst notes get what Typst can do; Markdown notes get Markdown's blocks. Every Typst command
//! must leave the note valid: inserting it never breaks the pages.

use marginalia_lib::notes::NoteFormat::{self, Markdown, Typst};
use marginalia_lib::problems::check_note;
use marginalia_lib::slash::{slash_commands, SlashCommand};

fn ids(format: NoteFormat) -> Vec<String> {
    slash_commands(format).into_iter().map(|c| c.id).collect()
}

fn command(format: NoteFormat, id: &str) -> SlashCommand {
    slash_commands(format).into_iter().find(|c| c.id == id).unwrap_or_else(|| panic!("no {id}"))
}

/// A note with the command inserted at `at` the way the editor does it: block commands start a
/// new line when the line already has text.
fn insert(note: &str, command: &SlashCommand) -> String {
    let separator = if command.block && !note.is_empty() && !note.ends_with('\n') { "\n" } else { "" };
    format!("{note}{separator}{}", command.insert)
}

mod what_is_offered {
    use super::*;

    #[test]
    fn typst_notes_get_what_typst_can_do() {
        let ids = ids(Typst);

        for id in [
            "heading-1", "heading-2", "heading-3", "bulleted-list", "numbered-list", "term-list",
            "bold", "italic", "highlight", "footnote", "link", "quote", "inline-maths",
            "display-maths", "matrix", "table", "figure", "code-block", "columns", "column-break",
            "page-break", "callout", "divider", "centered", "outline", "comment", "to-do",
        ] {
            assert!(ids.contains(&id.to_string()), "missing {id}");
        }
    }

    #[test]
    fn markdown_notes_get_markdowns_blocks() {
        let ids = ids(Markdown);

        for id in ["heading-1", "heading-2", "heading-3", "bulleted-list", "numbered-list", "to-do", "quote", "code-block", "table", "divider", "link"] {
            assert!(ids.contains(&id.to_string()), "missing {id}");
        }
    }

    /// They'd fail until notes can read the workspace's files (and never download anything).
    #[test]
    fn nothing_that_needs_files_or_the_internet_is_offered() {
        let ids = ids(Typst);

        for id in ["image", "bibliography", "citation", "import"] {
            assert!(!ids.contains(&id.to_string()), "{id} shouldn't be offered yet");
        }
    }

    #[test]
    fn every_command_has_a_name_a_group_and_a_short_description() {
        for format in [Typst, Markdown] {
            for command in slash_commands(format) {
                assert!(!command.label.is_empty(), "{}", command.id);
                assert!(!command.section.is_empty(), "{}", command.id);
                assert!(command.description.ends_with('.'), "{}: {:?}", command.id, command.description);
            }
        }
    }

    #[test]
    fn commands_are_grouped_into_sections() {
        let sections: Vec<String> = slash_commands(Typst).into_iter().map(|c| c.section).collect();

        for section in ["Text", "Lists", "Maths", "Layout", "Insert"] {
            assert!(sections.contains(&section.to_string()), "missing {section}");
        }
    }
}

mod inserting {
    use super::*;

    #[test]
    fn the_text_to_type_over_is_selected() {
        let heading = command(Typst, "heading-1");

        assert_eq!(heading.insert, "= Heading");
        assert_eq!(&heading.insert[heading.cursor..heading.cursor + heading.selection], "Heading");
    }

    #[test]
    fn blocks_are_marked_so_they_start_on_their_own_line() {
        assert!(command(Typst, "heading-1").block);
        assert!(command(Typst, "table").block);
        assert!(!command(Typst, "bold").block);
        assert!(!command(Typst, "inline-maths").block);
    }

    #[test]
    fn every_typst_command_leaves_an_empty_note_valid() {
        for command in slash_commands(Typst) {
            let note = insert("", &command);
            assert_eq!(check_note(&note), [], "{} gives {note:?}", command.id);
        }
    }

    #[test]
    fn every_typst_command_leaves_a_note_with_text_valid() {
        for command in slash_commands(Typst) {
            let note = insert("= Notes\nSome text so far ", &command);
            assert_eq!(check_note(&note), [], "{} gives {note:?}", command.id);
        }
    }

    /// Typing over the selected placeholder with other words keeps it valid too.
    #[test]
    fn every_typst_command_stays_valid_when_its_placeholder_is_typed_over() {
        for command in slash_commands(Typst) {
            let mut note = insert("Intro ", &command);
            let start = note.len() - command.insert.len() + command.cursor;
            note.replace_range(start..start + command.selection, if command.section == "Maths" { "y" } else { "my words" });
            assert_eq!(check_note(&note), [], "{} gives {note:?}", command.id);
        }
    }
}
