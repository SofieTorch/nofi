//! Spec: styling a table without writing code. The table editor offers Typst's table settings as
//! simple choices: its lines (all, between rows, academic, none), striped rows and a shaded
//! header, each column's alignment, the room inside cells, and the columns' widths. Each choice is
//! written as the plain Typst for it, read back the same way, and always valid. A setting written
//! some other way (by hand, as code) reads as "custom" and is kept unless a choice replaces it.

use marginalia_lib::pages::render_pages;
use marginalia_lib::problems::check_note;
use marginalia_lib::tables::{edit_table, read_table, Align, Lines, Spacing, TableAction, Widths};

const TABLE: &str = "#table(\n  columns: 2,\n  table.header([*Model*], [*Year*]),\n  [BERT], [2018],\n  [GPT], [2018],\n)";

/// The table after a change, made with the cursor in the first body cell.
fn styled(block: &str, action: TableAction) -> String {
    let cursor = block[..block.find("[BERT]").unwrap_or(0)].encode_utf16().count();
    let edited = edit_table(block, cursor, action).unwrap().block;
    assert_eq!(check_note(&edited), vec![], "invalid Typst:\n{edited}");
    assert!(render_pages(&edited).is_ok(), "doesn't draw:\n{edited}");
    edited
}

/// The table's settings: the lines between `columns:` and the cells.
fn settings(block: &str) -> Vec<String> {
    block
        .lines()
        .map(str::trim)
        .filter(|line| {
            ["stroke:", "fill:", "align:", "inset:", "columns:"].iter().any(|name| line.starts_with(name))
        })
        .map(|line| line.trim_end_matches(',').to_string())
        .collect()
}

mod reading_a_tables_style {
    use super::*;

    #[test]
    fn a_plain_table_has_every_default() {
        let style = read_table(TABLE).unwrap().style;

        assert_eq!(style.lines, Some(Lines::All));
        assert_eq!((style.striped, style.shaded_header), (Some(false), Some(false)));
        assert_eq!(style.align, Some(vec![Align::Left, Align::Left]));
        assert_eq!(style.spacing, Some(Spacing::Normal));
        assert_eq!(style.widths, Some(Widths::Auto));
    }

    #[test]
    fn reads_back_every_choice_it_writes() {
        let mut table = TABLE.to_string();
        for action in [
            TableAction::SetLines(Lines::Academic),
            TableAction::SetStriped(true),
            TableAction::SetShadedHeader(true),
            TableAction::SetAlign { column: 1, align: Align::Right },
            TableAction::SetSpacing(Spacing::Roomy),
            TableAction::SetWidths(Widths::Equal),
        ] {
            table = styled(&table, action);
        }

        let style = read_table(&table).unwrap().style;

        assert_eq!(style.lines, Some(Lines::Academic));
        assert_eq!((style.striped, style.shaded_header), (Some(true), Some(true)));
        assert_eq!(style.align, Some(vec![Align::Left, Align::Right]));
        assert_eq!(style.spacing, Some(Spacing::Roomy));
        assert_eq!(style.widths, Some(Widths::Equal));
    }

    #[test]
    fn settings_written_another_way_are_custom() {
        let table = TABLE.replace("columns: 2,", "columns: (3cm, 1fr),\n  stroke: 2pt + blue,\n  fill: red,\n  inset: 1em,");

        let style = read_table(&table).unwrap().style;

        assert_eq!((style.lines, style.striped, style.shaded_header), (None, None, None));
        assert_eq!((style.spacing, style.widths), (None, None));
    }

    #[test]
    fn one_alignment_for_the_whole_table_is_every_columns() {
        let table = TABLE.replace("columns: 2,", "columns: 2,\n  align: center,");

        assert_eq!(read_table(&table).unwrap().style.align, Some(vec![Align::Center, Align::Center]));
    }
}

mod lines {
    use super::*;

    #[test]
    fn all_lines_is_typsts_default_so_nothing_is_written() {
        let table = styled(&styled(TABLE, TableAction::SetLines(Lines::None)), TableAction::SetLines(Lines::All));

        assert_eq!(settings(&table), vec!["columns: 2"]);
    }

    #[test]
    fn lines_between_rows_only() {
        assert_eq!(settings(&styled(TABLE, TableAction::SetLines(Lines::Rows))), vec![
            "columns: 2",
            "stroke: (x: none, y: 0.5pt + luma(180))",
        ]);
    }

    #[test]
    fn academic_a_rule_above_below_the_header_and_at_the_bottom() {
        assert_eq!(settings(&styled(TABLE, TableAction::SetLines(Lines::Academic))), vec![
            "columns: 2",
            "stroke: (x, y) => (top: if y == 0 { 1pt } else if y == 1 { 0.5pt }, bottom: if y == 2 { 1pt })",
        ]);
    }

    #[test]
    fn academic_without_a_header_has_no_middle_rule() {
        let table = styled(TABLE, TableAction::ToggleHeader);

        assert_eq!(settings(&styled(&table, TableAction::SetLines(Lines::Academic))), vec![
            "columns: 2",
            "stroke: (x, y) => (top: if y == 0 { 1pt }, bottom: if y == 2 { 1pt })",
        ]);
    }

    #[test]
    fn the_academic_bottom_rule_follows_new_rows() {
        let table = styled(TABLE, TableAction::SetLines(Lines::Academic));

        let table = styled(&table, TableAction::AddRowBelow);

        assert!(settings(&table)[1].ends_with("bottom: if y == 3 { 1pt })"), "{table}");
    }

    #[test]
    fn no_lines() {
        assert_eq!(settings(&styled(TABLE, TableAction::SetLines(Lines::None))), vec!["columns: 2", "stroke: none"]);
    }

    #[test]
    fn a_choice_replaces_lines_written_by_hand() {
        let table = TABLE.replace("columns: 2,", "columns: 2,\n  stroke: 2pt + blue,");

        assert_eq!(settings(&styled(&table, TableAction::SetLines(Lines::None))), vec!["columns: 2", "stroke: none"]);
    }

    #[test]
    fn other_changes_keep_lines_written_by_hand() {
        let table = TABLE.replace("columns: 2,", "columns: 2,\n  stroke: 2pt + blue,");

        assert!(styled(&table, TableAction::AddRowBelow).contains("stroke: 2pt + blue,"));
    }
}

mod shading {
    use super::*;

    #[test]
    fn striped_rows_shade_every_other_row_under_the_header() {
        assert_eq!(settings(&styled(TABLE, TableAction::SetStriped(true))), vec![
            "columns: 2",
            "fill: (x, y) => if y > 0 and calc.even(y) { luma(245) }",
        ]);
    }

    #[test]
    fn a_shaded_header() {
        assert_eq!(settings(&styled(TABLE, TableAction::SetShadedHeader(true))), vec![
            "columns: 2",
            "fill: (x, y) => if y == 0 { luma(235) }",
        ]);
    }

    #[test]
    fn both_together() {
        let table = styled(&styled(TABLE, TableAction::SetStriped(true)), TableAction::SetShadedHeader(true));

        assert_eq!(settings(&table), vec![
            "columns: 2",
            "fill: (x, y) => if y == 0 { luma(235) } else if calc.even(y) { luma(245) }",
        ]);
    }

    #[test]
    fn without_a_header_stripes_start_on_the_second_row() {
        let table = styled(TABLE, TableAction::ToggleHeader);

        assert_eq!(settings(&styled(&table, TableAction::SetStriped(true))), vec![
            "columns: 2",
            "fill: (x, y) => if calc.odd(y) { luma(245) }",
        ]);
    }

    #[test]
    fn turning_them_off_writes_nothing() {
        let table = styled(TABLE, TableAction::SetStriped(true));

        assert_eq!(settings(&styled(&table, TableAction::SetStriped(false))), vec!["columns: 2"]);
    }
}

mod alignment {
    use super::*;

    #[test]
    fn one_column_aligned_differently() {
        assert_eq!(
            settings(&styled(TABLE, TableAction::SetAlign { column: 1, align: Align::Right })),
            vec!["columns: 2", "align: (left, right)"],
        );
    }

    #[test]
    fn every_column_the_same_is_written_once() {
        let table = styled(TABLE, TableAction::SetAlign { column: 0, align: Align::Center });

        assert_eq!(settings(&styled(&table, TableAction::SetAlign { column: 1, align: Align::Center })), vec![
            "columns: 2",
            "align: center",
        ]);
    }

    #[test]
    fn all_left_is_the_default_so_nothing_is_written() {
        let table = styled(TABLE, TableAction::SetAlign { column: 1, align: Align::Right });

        assert_eq!(settings(&styled(&table, TableAction::SetAlign { column: 1, align: Align::Left })), vec!["columns: 2"]);
    }

    #[test]
    fn follows_columns_being_added_and_removed() {
        let table = styled(TABLE, TableAction::SetAlign { column: 1, align: Align::Right });
        // The cursor is in the first column: a new one goes after it, left-aligned.
        let added = styled(&table, TableAction::AddColumnRight);
        assert_eq!(settings(&added)[1], "align: (left, left, right)");

        let removed = styled(&added, TableAction::DeleteColumn);
        assert_eq!(settings(&removed)[1], "align: (left, right)");
    }
}

mod spacing_and_widths {
    use super::*;

    #[test]
    fn compact_and_roomy_cells() {
        assert_eq!(settings(&styled(TABLE, TableAction::SetSpacing(Spacing::Compact)))[1], "inset: 3pt");
        assert_eq!(settings(&styled(TABLE, TableAction::SetSpacing(Spacing::Roomy)))[1], "inset: 8pt");
    }

    #[test]
    fn normal_is_typsts_default_so_nothing_is_written() {
        let table = styled(TABLE, TableAction::SetSpacing(Spacing::Roomy));

        assert_eq!(settings(&styled(&table, TableAction::SetSpacing(Spacing::Normal))), vec!["columns: 2"]);
    }

    #[test]
    fn equal_columns_share_the_width() {
        assert_eq!(settings(&styled(TABLE, TableAction::SetWidths(Widths::Equal))), vec!["columns: (1fr, 1fr)"]);
    }

    #[test]
    fn a_new_column_in_an_equal_table_is_equal_too() {
        let table = styled(TABLE, TableAction::SetWidths(Widths::Equal));

        assert_eq!(settings(&styled(&table, TableAction::AddColumnRight)), vec!["columns: (1fr, 1fr, 1fr)"]);
    }

    #[test]
    fn fitting_the_content_again() {
        let table = styled(TABLE, TableAction::SetWidths(Widths::Equal));

        assert_eq!(settings(&styled(&table, TableAction::SetWidths(Widths::Auto))), vec!["columns: 2"]);
    }
}

#[test]
fn styles_work_in_a_figure_with_a_caption_too() {
    let table = styled(TABLE, TableAction::SetCaption(Some("Models".into())));
    let table = styled(&table, TableAction::SetLines(Lines::Academic));
    let table = styled(&table, TableAction::SetStriped(true));

    assert_eq!(read_table(&table).unwrap().style.lines, Some(Lines::Academic));
}
