//! Spec: how the app's window is set up.

use std::fs;

fn window() -> serde_json::Value {
    let config: serde_json::Value = serde_json::from_str(&fs::read_to_string("tauri.conf.json").unwrap()).unwrap();
    config["app"]["windows"][0].clone()
}

/// Dragging notes from the explorer and tabs between panes is done by the page itself. By default
/// Tauri takes all dragging in the window over (for files dropped from outside), and then nothing
/// in the page can be dragged anywhere.
#[test]
fn the_page_handles_dragging_itself() {
    assert_eq!(window()["dragDropEnabled"], serde_json::Value::Bool(false));
}
