//! Spec: every way the format toolbar styles text in a Typst note is valid Typst. The examples are
//! shared with the frontend's tests (tests/fixtures/style-toggles.json), which check that the
//! toolbar produces exactly these results.

use marginalia_lib::problems::check_note;

fn examples() -> Vec<(String, String)> {
    let file = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/style-toggles.json")).unwrap();
    let json: serde_json::Value = serde_json::from_str(&file).unwrap();
    json["typst"]
        .as_array()
        .unwrap()
        .iter()
        .map(|example| {
            let after = example["after"].as_str().unwrap().replace(['«', '»'], "");
            (example["name"].as_str().unwrap().to_string(), after)
        })
        .collect()
}

#[test]
fn there_are_examples_to_check() {
    assert!(examples().len() > 10);
}

#[test]
fn every_styled_result_is_valid_typst() {
    for (name, note) in examples() {
        assert_eq!(check_note(&note), [], "{name}: {note:?}");
    }
}
