//! Spec: editing a table without writing code: adding and removing rows and columns where the
//! cursor is, turning the header row on and off, and giving it a caption (which makes it a numbered
//! figure). Positions are counted the way the editor counts characters. Every edit leaves valid Typst.

use marginalia_lib::problems::check_note;
use marginalia_lib::tables::{edit_table, read_table, table_info, TableAction};

const TABLE: &str = "#table(\n  columns: 3,\n  table.header[*Model*][*Year*][*Venue*],\n  [Transformer], [2017], [NeurIPS],\n  [BERT], [2018], [NAACL],\n)";

/// Where `part` starts in the table (the first time it appears).
fn at(block: &str, part: &str) -> usize {
    block[..block.find(part).unwrap()].encode_utf16().count()
}

fn edit(block: &str, cursor_on: &str, action: TableAction) -> (String, String) {
    let edited = edit_table(block, at(block, cursor_on), action).unwrap();
    let cursor: usize = edited.block.char_indices().nth(edited.cursor).map_or(edited.block.len(), |(i, _)| i);
    let after_cursor = edited.block[cursor..].chars().take(12).collect();
    (edited.block, after_cursor)
}

mod reading_a_table {
    use super::*;

    #[test]
    fn knows_its_size_its_header_and_where_the_cursor_is() {
        let info = table_info(TABLE, at(TABLE, "2018")).unwrap();

        assert_eq!((info.columns, info.rows, info.header), (3, 2, true));
        assert_eq!((info.row, info.column), (Some(1), Some(1)));
        assert_eq!(info.caption, None);
    }

    #[test]
    fn knows_a_figures_caption() {
        let figure = "#figure(\n  table(columns: 1, [A]),\n  caption: [Results so far],\n)";

        assert_eq!(table_info(figure, 0).unwrap().caption, Some("Results so far".into()));
    }

    #[test]
    fn counts_columns_written_as_widths() {
        let info = table_info("#table(columns: (1fr, 2fr), [a], [b])", 0).unwrap();

        assert_eq!(info.columns, 2);
    }

    /// Merged cells, lines and such: changing them here could break the table, so they're left alone.
    #[test]
    fn tables_with_merged_cells_are_left_to_the_code() {
        let error = table_info("#table(columns: 2, table.cell(colspan: 2)[wide], [a], [b])", 0).unwrap_err();

        assert_eq!(error, "This table can only be changed as code.");
    }

    #[test]
    fn something_that_isnt_a_table_isnt_read_as_one() {
        assert!(table_info("#grid(columns: 2, [a], [b])", 0).is_err());
    }
}

mod changing_a_table {
    use super::*;

    #[test]
    fn a_row_is_added_below_the_cursors_row_with_the_cursor_in_its_first_cell() {
        let (block, cursor) = edit(TABLE, "Transformer", TableAction::AddRowBelow);

        assert_eq!(
            block,
            "#table(\n  columns: 3,\n  table.header([*Model*], [*Year*], [*Venue*]),\n  [Transformer], [2017], [NeurIPS],\n  [], [], [],\n  [BERT], [2018], [NAACL],\n)"
        );
        assert!(cursor.starts_with("], [], [],"), "cursor before {cursor:?}");
    }

    #[test]
    fn a_column_is_added_right_of_the_cursors_column_in_every_row() {
        let (block, cursor) = edit(TABLE, "2017", TableAction::AddColumnRight);

        assert_eq!(
            block,
            "#table(\n  columns: 4,\n  table.header([*Model*], [*Year*], [], [*Venue*]),\n  [Transformer], [2017], [], [NeurIPS],\n  [BERT], [2018], [], [NAACL],\n)"
        );
        assert!(cursor.starts_with("], [NeurIPS]"), "cursor before {cursor:?}");
    }

    #[test]
    fn column_widths_get_one_more_width_too() {
        let (block, _) = edit("#table(columns: (1fr, 2fr), [a], [b])", "[a]", TableAction::AddColumnRight);

        assert!(block.contains("columns: (1fr, auto, 2fr),"), "{block}");
    }

    #[test]
    fn the_cursors_row_is_deleted() {
        let (block, _) = edit(TABLE, "BERT", TableAction::DeleteRow);

        assert!(!block.contains("BERT"));
        assert!(block.contains("[Transformer], [2017], [NeurIPS],"));
    }

    #[test]
    fn the_cursors_column_is_deleted_header_and_all() {
        let (block, _) = edit(TABLE, "2018", TableAction::DeleteColumn);

        assert_eq!(
            block,
            "#table(\n  columns: 2,\n  table.header([*Model*], [*Venue*]),\n  [Transformer], [NeurIPS],\n  [BERT], [NAACL],\n)"
        );
    }

    #[test]
    fn the_last_row_or_column_cant_be_deleted() {
        let single = "#table(columns: 1, [only])";

        assert_eq!(edit_table(single, 0, TableAction::DeleteRow).unwrap_err(), "A table needs at least one row.");
        assert_eq!(edit_table(single, 0, TableAction::DeleteColumn).unwrap_err(), "A table needs at least one column.");
    }

    #[test]
    fn the_header_row_is_turned_off_and_on() {
        let (without, _) = edit(TABLE, "BERT", TableAction::ToggleHeader);
        assert!(without.contains("  [*Model*], [*Year*], [*Venue*],\n  [Transformer]"), "{without}");
        assert!(!without.contains("table.header"));

        let (with, _) = edit(&without, "BERT", TableAction::ToggleHeader);
        assert!(with.contains("table.header([*Model*], [*Year*], [*Venue*]),"), "{with}");
    }

    #[test]
    fn a_caption_makes_it_a_numbered_figure() {
        let (block, _) = edit(TABLE, "BERT", TableAction::SetCaption(Some("Models compared".into())));

        assert_eq!(
            block,
            "#figure(\n  table(\n    columns: 3,\n    table.header([*Model*], [*Year*], [*Venue*]),\n    [Transformer], [2017], [NeurIPS],\n    [BERT], [2018], [NAACL],\n  ),\n  caption: [Models compared],\n)"
        );
    }

    #[test]
    fn a_caption_is_changed_and_removed() {
        let figure = "#figure(\n  table(columns: 1, [A]),\n  caption: [Old],\n)";

        let (changed, _) = edit(figure, "A", TableAction::SetCaption(Some("New".into())));
        let (removed, _) = edit(figure, "A", TableAction::SetCaption(None));

        assert!(changed.contains("caption: [New],"), "{changed}");
        assert_eq!(removed, "#table(\n  columns: 1,\n  [A],\n)");
    }

    #[test]
    fn a_caption_with_special_characters_stays_text() {
        let (block, _) = edit(TABLE, "BERT", TableAction::SetCaption(Some("Costs in $ *per* run #1".into())));

        assert_eq!(table_info(&block, 0).unwrap().caption, Some("Costs in $ *per* run #1".into()));
        assert_eq!(check_note(&block), []);
    }

    #[test]
    fn the_tables_other_settings_are_kept() {
        let styled = "#table(columns: 2, gutter: 3pt, stroke: 2pt + blue, [a], [b])";

        let (block, _) = edit(styled, "[a]", TableAction::AddRowBelow);

        assert!(block.contains("  gutter: 3pt,\n  stroke: 2pt + blue,\n"), "{block}");
    }

    #[test]
    fn every_change_leaves_a_valid_note() {
        let tables = [TABLE, "#table(columns: (1fr, 2fr), stroke: none, [a], [b], [c], [d])", "#figure(\n  table(columns: 2, [A], [B]),\n  caption: [Results],\n)"];
        let actions = [
            TableAction::AddRowBelow,
            TableAction::AddColumnRight,
            TableAction::DeleteRow,
            TableAction::DeleteColumn,
            TableAction::ToggleHeader,
            TableAction::SetCaption(Some("A caption".into())),
            TableAction::SetCaption(None),
        ];
        for table in tables {
            for action in actions.clone() {
                let Ok(edited) = edit_table(table, at(table, "["), action.clone()) else { continue };
                assert_eq!(check_note(&edited.block), [], "{action:?} on {table:?} gives {:?}", edited.block);
            }
        }
    }
}

mod the_cells {
    use super::*;

    fn texts(block: &str) -> (Option<Vec<String>>, Vec<Vec<String>>) {
        let table = read_table(block).unwrap();
        (
            table.header.map(|cells| cells.into_iter().map(|c| c.text).collect()),
            table.rows.into_iter().map(|row| row.into_iter().map(|c| c.text).collect()).collect(),
        )
    }

    fn set(block: &str, row: Option<usize>, column: usize, text: &str) -> String {
        edit_table(block, 0, TableAction::SetCell { row, column, text: text.into() }).unwrap().block
    }

    #[test]
    fn each_cells_text_is_read_header_and_all() {
        let (header, rows) = texts(TABLE);

        assert_eq!(header, Some(vec!["*Model*".into(), "*Year*".into(), "*Venue*".into()]));
        assert_eq!(rows[1], ["BERT", "2018", "NAACL"]);
    }

    /// Characters escaped to stay text are shown as typed, without the backslashes.
    #[test]
    fn text_written_as_plain_text_reads_back_as_typed() {
        let (_, rows) = texts("#table(columns: 1, [costs \\$5])");

        assert_eq!(rows[0], ["costs $5"]);
    }

    #[test]
    fn cells_written_as_code_cant_be_edited_as_text() {
        let table = read_table("#table(columns: 2, [text], \"a string\")").unwrap();

        assert!(table.rows[0][0].editable);
        assert!(!table.rows[0][1].editable);
    }

    #[test]
    fn knows_where_each_cell_starts_so_changes_can_be_made_at_it() {
        let table = read_table(TABLE).unwrap();
        let bert = &table.rows[1][0];

        let edited = edit_table(TABLE, bert.start, TableAction::DeleteRow).unwrap();

        assert!(!edited.block.contains("BERT"));
    }

    #[test]
    fn a_cell_is_set() {
        let block = set(TABLE, Some(1), 2, "ACL");

        assert!(block.contains("[BERT], [2018], [ACL],"), "{block}");
    }

    #[test]
    fn a_header_cell_is_set() {
        let block = set(TABLE, None, 0, "*Name*");

        assert!(block.contains("table.header([*Name*], [*Year*], [*Venue*]),"), "{block}");
    }

    #[test]
    fn styles_typed_in_a_cell_are_kept() {
        assert!(set(TABLE, Some(0), 0, "*Transformer* v2").contains("[*Transformer* v2],"));
    }

    /// "$5" would start maths that never ends: it's written as text instead, so nothing breaks.
    #[test]
    fn text_that_would_break_the_note_is_written_as_plain_text() {
        for text in ["costs $5", "2 * 3", "a ] b", "see @me", "#oops"] {
            let block = set(TABLE, Some(0), 1, text);

            assert_eq!(check_note(&block), [], "{text:?} gives {block}");
            assert_eq!(texts(&block).1[0][1], text, "{block}");
        }
    }

    #[test]
    fn the_cursor_goes_to_the_cell_that_was_set() {
        let edited = edit_table(TABLE, 0, TableAction::SetCell { row: Some(1), column: 1, text: "1999".into() }).unwrap();

        assert!(edited.block[edited.cursor..].starts_with("1999]"), "{}", &edited.block[edited.cursor..]);
    }
}
