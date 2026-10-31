//! Spec: page settings for Typst notes (paper, columns, margins, font…). They're stored as the
//! Typst code you'd write by hand: `#set page(…)` and `#set text(…)` rules. The settings popover
//! only edits what it understands; anything else stays as code, untouched.

use marginalia_lib::page_settings::*;
use marginalia_lib::pages::render_pages;
use marginalia_lib::problems::check_note;

fn values(note: &str) -> PageSettings {
    read_page_settings(note).values
}

fn locked(note: &str) -> Vec<String> {
    read_page_settings(note).locked
}

fn change(note: &str, setting: PageSetting) -> String {
    change_page_setting(note, setting).unwrap()
}

mod reading_settings {
    use super::*;

    #[test]
    fn a_note_without_settings_uses_typsts_defaults() {
        let settings = read_page_settings("= Notes\nSome text.");

        assert_eq!(settings.values, PageSettings::default());
        assert!(settings.locked.is_empty());
    }

    #[test]
    fn reads_them_from_the_notes_set_rules() {
        let note = "#set page(paper: \"us-letter\", flipped: true, columns: 2, margin: 2cm)\n\
                    #set text(font: \"Libertinus Serif\", size: 12pt)\n= Notes";

        assert_eq!(
            values(note),
            PageSettings {
                paper: Some("us-letter".into()),
                landscape: Some(true),
                columns: Some(2),
                margin_cm: Some(2.0),
                font: Some("Libertinus Serif".into()),
                text_size_pt: Some(12.0),
                ..Default::default()
            }
        );
    }

    #[test]
    fn reads_paragraph_settings_and_the_language() {
        let note = "#set par(justify: true, leading: 1em, first-line-indent: 1.5em)\n#set text(lang: \"es\")";

        let settings = values(note);

        assert_eq!(settings.justify, Some(true));
        assert_eq!(settings.line_spacing_em, Some(1.0));
        assert_eq!(settings.first_line_indent_em, Some(1.5));
        assert_eq!(settings.language, Some("es".into()));
    }

    #[test]
    fn reads_page_numbers_and_the_header_and_footer_text() {
        let settings = values("#set page(numbering: \"1 / 1\", header: [My notes], footer: [Draft \\#2])");

        assert_eq!(settings.page_numbers, Some("1 / 1".into()));
        assert_eq!(settings.header, Some("My notes".into()));
        assert_eq!(settings.footer, Some("Draft #2".into()));
    }

    /// A header with code in it (like today's date) is more than text: it stays as code.
    #[test]
    fn a_header_with_code_in_it_is_left_to_the_code() {
        assert_eq!(locked("#set page(header: [Notes #emph[v2]])"), ["header"]);
    }

    /// Line spacing and indents relative to the text size (em) are what the popover edits.
    #[test]
    fn paragraph_spacing_in_other_units_is_left_to_the_code() {
        assert_eq!(locked("#set par(leading: 5pt, first-line-indent: (amount: 1em, all: true))"), ["lineSpacing", "firstLineIndent"]);
    }

    #[test]
    fn margins_and_sizes_in_other_units_are_converted() {
        let settings = values("#set page(margin: 25mm)\n#set text(size: 0.5cm)");

        assert_eq!(settings.margin_cm, Some(2.5));
        assert!((settings.text_size_pt.unwrap() - 14.17).abs() < 0.01);
    }

    /// For example different margins per side, or several fonts: the popover leaves them alone.
    #[test]
    fn settings_written_in_ways_the_popover_cant_edit_are_left_to_the_code() {
        let note = "#set page(margin: (x: 1cm, y: 2cm), columns: 2)\n#set text(font: (\"A\", \"B\"))";

        assert_eq!(locked(note), ["margin", "font"]);
        assert_eq!(values(note).columns, Some(2));
        assert_eq!(values(note).margin_cm, None);
    }

    #[test]
    fn a_setting_changed_again_further_down_is_left_to_the_code() {
        let note = "#set page(columns: 2)\n= Part two\n#set page(columns: 1)";

        assert_eq!(locked(note), ["columns"]);
    }

    #[test]
    fn rules_inside_other_code_dont_count() {
        let note = "#[\n  #set page(columns: 3)\n]";

        assert_eq!(values(note).columns, None);
        assert!(locked(note).is_empty());
    }
}

mod changing_settings {
    use super::*;

    #[test]
    fn adds_a_set_rule_at_the_top_when_the_note_has_none() {
        let note = change("= Notes", PageSetting::Columns(Some(2)));

        assert_eq!(note, "#set page(columns: 2)\n= Notes");
    }

    #[test]
    fn the_rule_goes_after_the_notes_properties() {
        let note = change("#metadata((year: 2017)) <properties>\n= Notes", PageSetting::Columns(Some(2)));

        assert_eq!(note, "#metadata((year: 2017)) <properties>\n#set page(columns: 2)\n= Notes");
    }

    #[test]
    fn page_and_text_settings_go_in_their_own_rules() {
        let note = change("= Notes", PageSetting::Font(Some("Libertinus Serif".into())));
        let note = change(&note, PageSetting::Paper(Some("a5".into())));

        assert_eq!(note, "#set page(paper: \"a5\")\n#set text(font: \"Libertinus Serif\")\n= Notes");
    }

    #[test]
    fn changes_the_value_in_the_existing_rule_and_keeps_everything_else() {
        let note = "#set page(paper: \"a4\",  numbering: \"1\")\n= Notes";

        let changed = change(note, PageSetting::Paper(Some("a5".into())));
        let added = change(note, PageSetting::Columns(Some(2)));

        assert_eq!(changed, "#set page(paper: \"a5\",  numbering: \"1\")\n= Notes");
        assert_eq!(added, "#set page(paper: \"a4\",  numbering: \"1\", columns: 2)\n= Notes");
    }

    #[test]
    fn values_are_written_the_way_typst_expects() {
        let note = change("", PageSetting::MarginCm(Some(1.5)));
        let note = change(&note, PageSetting::TextSizePt(Some(10.5)));
        let note = change(&note, PageSetting::Landscape(Some(true)));

        assert_eq!(note, "#set page(margin: 1.5cm, flipped: true)\n#set text(size: 10.5pt)\n");
    }

    #[test]
    fn paragraph_settings_go_in_a_par_rule_after_the_page_and_text_rules() {
        let note = change("= Notes", PageSetting::Justify(Some(true)));
        let note = change(&note, PageSetting::LineSpacingEm(Some(1.0)));
        let note = change(&note, PageSetting::FirstLineIndentEm(Some(1.5)));
        let note = change(&note, PageSetting::Language(Some("es".into())));
        let note = change(&note, PageSetting::Columns(Some(2)));

        assert_eq!(
            note,
            "#set page(columns: 2)\n#set text(lang: \"es\")\n#set par(justify: true, leading: 1em, first-line-indent: 1.5em)\n= Notes"
        );
        assert!(render_pages(&note).is_ok());
    }

    #[test]
    fn page_numbers_header_and_footer_are_written() {
        let note = change("Text", PageSetting::PageNumbers(Some("1".into())));
        let note = change(&note, PageSetting::Header(Some("My notes".into())));

        assert_eq!(note, "#set page(numbering: \"1\", header: [My notes])\nText");
        assert!(render_pages(&note).is_ok());
    }

    /// Characters that mean something in Typst stay text in the header.
    #[test]
    fn header_text_is_kept_as_text_whatever_it_contains() {
        let text = "= Draft *v2* #1 $5 @me <tag> [x] \\ _a_ `c` - end";

        let note = change("Text", PageSetting::Header(Some(text.into())));

        assert_eq!(check_note(&note), []);
        assert_eq!(values(&note).header, Some(text.into()));
    }

    #[test]
    fn not_justifying_is_the_default_so_it_isnt_written() {
        let note = change("#set par(justify: true)\nText", PageSetting::Justify(Some(false)));

        assert_eq!(note, "Text");
    }

    #[test]
    fn going_back_to_the_default_removes_the_setting() {
        let note = "#set page(paper: \"a5\", columns: 2)\n= Notes";

        assert_eq!(change(note, PageSetting::Paper(None)), "#set page(columns: 2)\n= Notes");
        assert_eq!(change(note, PageSetting::Columns(None)), "#set page(paper: \"a5\")\n= Notes");
    }

    #[test]
    fn removing_the_last_setting_removes_the_rule() {
        let note = "#set page(columns: 2)\n= Notes";

        assert_eq!(change(note, PageSetting::Columns(None)), "= Notes");
    }

    #[test]
    fn removing_a_setting_that_isnt_there_changes_nothing() {
        assert_eq!(change("= Notes", PageSetting::Columns(None)), "= Notes");
    }

    #[test]
    fn settings_left_to_the_code_arent_changed() {
        let note = "#set page(margin: (x: 1cm))";

        let error = change_page_setting(note, PageSetting::MarginCm(Some(2.0))).unwrap_err();

        assert_eq!(error, "The margin is set in the note's code; change it there.");
    }

    #[test]
    fn the_note_still_draws_after_a_change() {
        let note = change("Some text.", PageSetting::Columns(Some(2)));
        let note = change(&note, PageSetting::Paper(Some("a5".into())));

        let pages = render_pages(&note).unwrap().pictures();

        assert_eq!((pages[0].width.round(), pages[0].height.round()), (420.0, 595.0));
    }
}

mod fonts {
    use super::*;

    /// They come with the app, so a note using them looks the same on every computer.
    #[test]
    fn the_fonts_that_come_with_typst_are_always_offered() {
        let fonts = font_families();

        assert!(fonts.contains(&"Libertinus Serif".to_string()), "{fonts:?}");
        assert!(fonts.contains(&"New Computer Modern".to_string()), "{fonts:?}");
    }

    #[test]
    fn each_font_is_listed_once_in_alphabetical_order() {
        let fonts = font_families();

        let mut sorted = fonts.clone();
        sorted.sort_by_key(|name| name.to_lowercase());
        sorted.dedup();
        assert_eq!(fonts, sorted);
    }

    #[test]
    fn a_chosen_font_is_used_for_the_pages() {
        let note = change("Hello", PageSetting::Font(Some("New Computer Modern".into())));

        assert!(render_pages(&note).is_ok());
    }
}
