//! Spec: finding the mistakes in a Typst note while it's written, explaining them plainly, and
//! offering fixes that turn it back into a note that draws. The most common accidents in normal
//! writing are characters that mean something in Typst: `$5`, `user@mail.com`, `2 * 3`, `C#`.

use marginalia_lib::pages::render_pages;
use marginalia_lib::problems::{check_note, Fix, Problem};

fn problems(note: &str) -> Vec<Problem> {
    check_note(note)
}

fn only_problem(note: &str) -> Problem {
    let mut found = problems(note);
    assert_eq!(found.len(), 1, "{found:#?}");
    found.remove(0)
}

/// The note after applying a fix (positions are counted like the editor counts).
fn apply(note: &str, fix: &Fix) -> String {
    let units: Vec<u16> = note.encode_utf16().collect();
    let before = String::from_utf16(&units[..fix.from]).unwrap();
    let after = String::from_utf16(&units[fix.to..]).unwrap();
    format!("{before}{}{after}", fix.insert)
}

fn fix(note: &str, label: &str) -> String {
    let problem = only_problem(note);
    let fix = problem
        .fixes
        .iter()
        .find(|fix| fix.label == label)
        .unwrap_or_else(|| panic!("no fix {label:?} in {:?}", problem.fixes));
    apply(note, fix)
}

fn draws(note: &str) -> bool {
    render_pages(note).is_ok()
}

mod finding_mistakes {
    use super::*;

    #[test]
    fn a_note_without_mistakes_has_no_problems() {
        assert!(problems("= Ideas\nRead *more* papers, $x^2$ and a snake_case name.").is_empty());
    }

    #[test]
    fn a_mistake_is_found_exactly_where_it_is() {
        let problem = only_problem("It costs $5 today.");

        assert_eq!((problem.from, problem.to), (9, 10));
        assert_eq!(problem.severity, "error");
    }

    #[test]
    fn common_accidents_are_explained_plainly() {
        let message = |note: &str| only_problem(note).message;

        assert_eq!(message("It costs $5 today."), "This $ starts maths, but the maths never ends.");
        assert_eq!(message("2 * 3 = 6"), "This * starts bold text, but the bold text never ends.");
        assert_eq!(message("Read _slowly"), "This _ starts italic text, but the italic text never ends.");
        assert_eq!(message("a `code"), "This ` starts code, but the code never ends.");
        assert_eq!(message("#set page(columns: 2"), "This ( is never closed.");
        assert_eq!(message("C# is a language"), "# starts Typst code, but no code follows it.");
        assert_eq!(
            message("Mail me at user@mail.com"),
            "@ refers to a label, but this note has no <mail.com> label."
        );
    }

    #[test]
    fn other_mistakes_use_typsts_own_message() {
        assert_eq!(only_problem("#foo").message, "Unknown variable: foo.");
    }

    #[test]
    fn typsts_hints_come_along() {
        let problem = only_problem("So $alpah$ holds.");

        assert!(problem.hints.iter().any(|hint| hint.contains("`a l p a h`")), "{:?}", problem.hints);
    }

    /// Warnings are worth knowing about, but the pages still draw.
    #[test]
    fn warnings_are_problems_too_but_dont_stop_the_pages() {
        let note = "#set text(font: \"No Such Font\")\nHi";

        let problem = only_problem(note);

        assert_eq!(problem.severity, "warning");
        assert!(draws(note));
    }

    #[test]
    fn positions_count_characters_the_way_the_editor_does() {
        let problem = only_problem("Café ☕ costs $5.");

        assert_eq!(problem.from, "Café ☕ costs ".encode_utf16().count());
    }
}

mod fixing_mistakes {
    use super::*;

    #[test]
    fn a_dollar_that_isnt_maths_can_be_written_as_text() {
        let fixed = fix("It costs $5 today.", "Write $ as text");

        assert_eq!(fixed, "It costs \\$5 today.");
        assert!(draws(&fixed));
    }

    #[test]
    fn maths_that_never_ends_can_be_closed_at_the_end_of_its_line() {
        let fixed = fix("Then $x^2 + 1\nNext line.", "Close the maths");

        assert_eq!(fixed, "Then $x^2 + 1$\nNext line.");
        assert!(draws(&fixed));
    }

    #[test]
    fn a_star_or_underscore_can_be_written_as_text_or_closed() {
        assert_eq!(fix("2 * 3 = 6", "Write * as text"), "2 \\* 3 = 6");
        assert_eq!(fix("Read *more papers", "Close the bold text"), "Read *more papers*");
        assert_eq!(fix("Read _slowly", "Write _ as text"), "Read \\_slowly");
        assert_eq!(fix("Read _slowly", "Close the italic text"), "Read _slowly_");
    }

    #[test]
    fn an_at_sign_that_isnt_a_reference_can_be_written_as_text() {
        let fixed = fix("Mail me at user@mail.com please.", "Write @ as text");

        assert_eq!(fixed, "Mail me at user\\@mail.com please.");
        assert!(draws(&fixed));
    }

    #[test]
    fn a_hash_that_isnt_code_can_be_written_as_text() {
        let fixed = fix("C# is a language", "Write # as text");

        assert_eq!(fixed, "C\\# is a language");
        assert!(draws(&fixed));
    }

    #[test]
    fn unclosed_brackets_and_code_can_be_closed() {
        assert_eq!(fix("#set page(columns: 2", "Close it"), "#set page(columns: 2)");
        assert_eq!(fix("a `code", "Close the code"), "a `code`");
    }

    #[test]
    fn a_misspelled_name_suggests_the_closest_real_one() {
        assert_eq!(fix("So $alpah$ holds.", "Use alpha"), "So $alpha$ holds.");
        assert_eq!(fix("#text(fill: bleu)[x]", "Use blue"), "#text(fill: blue)[x]");
    }

    #[test]
    fn typsts_own_suggestions_become_fixes() {
        assert_eq!(fix("So $alpah$ holds.", "Use a l p a h"), "So $a l p a h$ holds.");
        assert_eq!(fix("So $alpah$ holds.", "Use \"alpah\""), "So $\"alpah\"$ holds.");
    }

    /// Closing the maths in "It costs $5 today." would make "today" maths, which isn't valid.
    #[test]
    fn a_fix_that_wouldnt_help_isnt_offered() {
        let labels: Vec<String> =
            only_problem("It costs $5 today.").fixes.into_iter().map(|fix| fix.label).collect();

        assert_eq!(labels, ["Write $ as text"]);
    }

    /// The unclosed $ hides the @ mistake after it; fixing the $ reveals it, and that's fine.
    #[test]
    fn a_fix_is_offered_even_if_another_mistake_comes_later() {
        let note = "It costs $5 per hour.\nMail me at user@mail.com";

        let labels: Vec<String> = problems(note)[0].fixes.iter().map(|fix| fix.label.clone()).collect();

        assert_eq!(labels, ["Write $ as text"]);
    }

    /// Whatever fix is chosen, the note can be drawn afterwards.
    #[test]
    fn every_fix_leads_to_a_note_that_draws() {
        let accidents = [
            "It costs $5 today.",
            "2 * 3 = 6",
            "Read _slowly",
            "Mail me at user@mail.com",
            "C# is a language",
            "#set page(columns: 2",
            "a `code",
            "So $alpah$ holds.",
            "#text(fill: bleu)[x]",
        ];
        for note in accidents {
            let problem = only_problem(note);
            assert!(!problem.fixes.is_empty(), "no fixes for {note:?}");
            for fix in &problem.fixes {
                let fixed = apply(note, fix);
                assert!(draws(&fixed), "{note:?} + {:?} gives {fixed:?}, which doesn't draw", fix.label);
            }
        }
    }
}
