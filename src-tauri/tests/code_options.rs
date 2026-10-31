//! Spec: line numbers and highlighted lines of code blocks are valid Typst, so they show in the
//! pages too. The examples are shared with the frontend's tests (tests/fixtures/code-options.json),
//! which check that the editor writes exactly these.

use marginalia_lib::pages::render_pages;
use marginalia_lib::problems::check_note;

fn examples() -> Vec<(String, String)> {
    let file = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/code-options.json")).unwrap();
    let json: serde_json::Value = serde_json::from_str(&file).unwrap();
    json["typst"]
        .as_array()
        .unwrap()
        .iter()
        .map(|example| (example["name"].as_str().unwrap().into(), example["after"].as_str().unwrap().into()))
        .collect()
}

#[test]
fn there_are_examples_to_check() {
    assert!(examples().len() >= 5);
}

#[test]
fn every_written_code_block_is_valid_typst_and_draws() {
    for (name, note) in examples() {
        assert_eq!(check_note(&note), [], "{name}: {note}");
        assert!(render_pages(&note).is_ok(), "{name}: {note}");
    }
}
