//! Spec: checklists. "- [ ] task" is a task to do and "- [x] task" one that's done, in Markdown
//! and in Typst alike. Typst has no checklists of its own, so a Typst note with one carries a small
//! rule (src/editor/checklistRule.typ, which the editor adds) that draws them as checkboxes, done
//! tasks dimmed. It's plain Typst: the note draws the same in any Typst program.

use marginalia_lib::pages::render_pages;
use marginalia_lib::problems::check_note;
use marginalia_lib::slash::slash_commands;
use marginalia_lib::notes::NoteFormat;

fn rule() -> String {
    std::fs::read_to_string("../src/editor/checklistRule.typ").unwrap()
}

/// The note's first page, as drawn.
fn drawn(note: &str) -> String {
    assert_eq!(check_note(note), vec![], "invalid Typst:\n{note}");
    render_pages(note).unwrap().pictures()[0].svg.clone()
}

const TASKS: &str = "- [ ] Buy milk\n- [x] Bake *bread*\n  - [ ] Nested task\n- [ ] Call home\n";

#[test]
fn a_checklist_with_the_rule_is_valid_and_draws() {
    drawn(&format!("{}{TASKS}", rule()));
}

#[test]
fn the_rule_draws_checkboxes_instead_of_bullets() {
    let with_rule = drawn(&format!("{}{TASKS}", rule()));
    let without = drawn(TASKS);

    assert_ne!(with_rule, without);
}

#[test]
fn lists_without_tasks_are_drawn_as_before() {
    let list = "- one\n- two\n  - three\n+ numbered\n";

    // (Comments draw nothing, so only the rule's effect could differ.)
    assert_eq!(drawn(&format!("{}{list}", rule())), drawn(&format!("// x\n{list}")));
}

#[test]
fn a_list_mixing_tasks_and_bullets_draws() {
    drawn(&format!("{}- [ ] a task\n- a bullet\n- [x] done\n", rule()));
}

#[test]
fn an_empty_task_draws() {
    drawn(&format!("{}- [ ]\n- [x]\n", rule()));
}

#[test]
fn the_rule_alone_draws_an_empty_note() {
    drawn(&rule());
}

#[test]
fn the_rule_starts_with_a_comment_saying_what_it_is() {
    assert!(rule().starts_with("// Checklists:"));
    assert!(rule().ends_with("}\n"));
}

#[test]
fn typst_notes_get_a_to_do_list_command() {
    let to_do = slash_commands(NoteFormat::Typst).into_iter().find(|c| c.id == "to-do").unwrap();

    assert_eq!(to_do.insert, "- [ ] Task");
    assert_eq!(to_do.label, "To-do list");
}
