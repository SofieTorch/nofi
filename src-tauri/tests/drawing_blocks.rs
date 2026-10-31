//! Spec: drawing a table, figure or grid on its own, so the writing view can show it as it will
//! look instead of as code (like maths).

use marginalia_lib::maths::{render_block, BLOCK_WIDTH_PT};

fn size_of(svg: &str) -> (f64, f64) {
    let number = |attribute: &str| -> f64 {
        let start = svg.find(&format!("{attribute}=\"")).unwrap() + attribute.len() + 2;
        let rest = &svg[start..];
        rest[..rest.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap()].parse().unwrap()
    };
    (number("width"), number("height"))
}

const TABLE: &str = "#table(\n  columns: 3,\n  table.header[*Name*][*Year*][*Venue*],\n  [Transformer], [2017], [NeurIPS],\n)";

#[test]
fn a_table_is_drawn_as_wide_as_the_writing_view_and_only_as_tall_as_it_needs() {
    let (width, height) = size_of(&render_block(TABLE).unwrap());

    assert_eq!(width, BLOCK_WIDTH_PT);
    assert!(height > 10.0 && height < 80.0, "height was {height}");
}

/// Letters hanging below the line (like the "g" in "settings") used to be cut off.
#[test]
fn nothing_is_cut_off_at_the_bottom() {
    let svg = render_block("#figure(table(columns: 1, [A]), caption: [Base model settings])").unwrap();
    let (_, height) = size_of(&svg);
    let (_, without_room) = size_of(&render_block("#figure(table(columns: 1, [A]))").unwrap());

    assert!(height - without_room > 10.0, "the caption needs room: {height} vs {without_room}");
    assert!(svg.contains("viewBox=\"0 0 450"), "{}", &svg[..120]);
}

#[test]
fn figures_and_grids_are_drawn_too() {
    assert!(render_block("#figure(\n  table(columns: 2, [A], [B]),\n  caption: [Results],\n)").is_ok());
    assert!(render_block("#grid(columns: 2, gutter: 1em, [Left], [Right])").is_ok());
}

#[test]
fn lines_are_drawn_too_thin_and_as_wide_as_they_are_set() {
    let (width, height) = size_of(&render_block("#line(length: 100%, stroke: 2pt + gray)").unwrap());

    assert_eq!(width, BLOCK_WIDTH_PT);
    assert!(height < 20.0, "height was {height}");
}

#[test]
fn a_table_with_a_mistake_is_explained() {
    let error = render_block("#table(columns: 2, [A], [B], fill: bleu)").unwrap_err();

    assert_eq!(error, "Unknown variable: bleu.");
}

#[test]
fn only_a_single_table_figure_grid_or_line_is_drawn() {
    assert!(render_block("Some text").is_err());
    assert!(render_block(&format!("{TABLE} and more text")).is_err());
    assert!(render_block("#text(red)[hi]").is_err());
}

#[test]
fn drawing_cant_read_files() {
    assert!(render_block("#table(columns: 1, read(\"/etc/hosts\"))").is_err());
}
