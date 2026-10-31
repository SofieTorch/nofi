//! The native app menu: the platform's default menu plus the app's own items.
//! Clicking one sends a "menu" event to the frontend with the action's id (see `onMenuAction` in src/api.ts).

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};

const NEW_NOTE: &str = "new-note";
const NEW_MARKDOWN_NOTE: &str = "new-markdown-note";
const CLOSE_WORKSPACE: &str = "close-workspace";
const TOGGLE_EXPLORER_PINNED: &str = "toggle-explorer-pinned";
const MOVE_EXPLORER_TO_OTHER_SIDE: &str = "move-explorer-to-other-side";
const TOGGLE_PAGES: &str = "toggle-pages";
const UNDO: &str = "undo";
const REDO: &str = "redo";
const SHOW_SUGGESTIONS: &str = "show-suggestions";

const ACTIONS: [&str; 9] = [
    NEW_NOTE,
    NEW_MARKDOWN_NOTE,
    CLOSE_WORKSPACE,
    TOGGLE_EXPLORER_PINNED,
    MOVE_EXPLORER_TO_OTHER_SIDE,
    TOGGLE_PAGES,
    UNDO,
    REDO,
    SHOW_SUGGESTIONS,
];

/// Items that only make sense while a workspace is open.
struct WorkspaceItems {
    new_note: MenuItem<Wry>,
    new_markdown_note: MenuItem<Wry>,
    close: MenuItem<Wry>,
    pin_explorer: CheckMenuItem<Wry>,
    move_explorer: MenuItem<Wry>,
    show_pages: CheckMenuItem<Wry>,
}

/// Starts from the default menu so the standard Edit menu (and copy/paste shortcuts) keep working.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let items = WorkspaceItems {
        new_note: MenuItem::with_id(app, NEW_NOTE, "New Note", false, Some("CmdOrCtrl+N"))?,
        new_markdown_note: MenuItem::with_id(
            app,
            NEW_MARKDOWN_NOTE,
            "New Markdown Note",
            false,
            None::<&str>,
        )?,
        close: MenuItem::with_id(app, CLOSE_WORKSPACE, "Close Workspace", false, None::<&str>)?,
        pin_explorer: CheckMenuItem::with_id(
            app,
            TOGGLE_EXPLORER_PINNED,
            "Pin File Explorer",
            false,
            true,
            Some("CmdOrCtrl+\\"),
        )?,
        move_explorer: MenuItem::with_id(
            app,
            MOVE_EXPLORER_TO_OTHER_SIDE,
            "Move File Explorer to Other Side",
            false,
            None::<&str>,
        )?,
        show_pages: CheckMenuItem::with_id(
            app,
            TOGGLE_PAGES,
            "Show Pages",
            false,
            false,
            Some("CmdOrCtrl+Alt+P"),
        )?,
    };

    let file = find_or_add_submenu(app, &menu, "File", None)?;
    file.insert(&items.new_note, 0)?;
    file.insert(&items.new_markdown_note, 1)?;
    file.insert(&PredefinedMenuItem::separator(app)?, 2)?;
    file.insert(&items.close, 3)?;
    file.insert(&PredefinedMenuItem::separator(app)?, 4)?;

    // The app decides what Undo means: typing in the editor, or the last file action elsewhere.
    let edit = find_or_add_submenu(app, &menu, "Edit", Some("File"))?;
    for item in edit.items()? {
        if let Some(predefined) = item.as_predefined_menuitem() {
            if predefined.text().is_ok_and(|text| text == "Undo" || text == "Redo") {
                edit.remove(predefined)?;
            }
        }
    }
    edit.insert(&MenuItem::with_id(app, UNDO, "Undo", true, Some("CmdOrCtrl+Z"))?, 0)?;
    edit.insert(&MenuItem::with_id(app, REDO, "Redo", true, Some("CmdOrCtrl+Shift+Z"))?, 1)?;
    // Ctrl+Space works in the editor too, but on a Mac it usually switches the keyboard language.
    let suggestions =
        MenuItem::with_id(app, SHOW_SUGGESTIONS, "Show Suggestions", true, Some("CmdOrCtrl+I"))?;
    edit.append(&PredefinedMenuItem::separator(app)?)?;
    edit.append(&suggestions)?;

    let view = find_or_add_submenu(app, &menu, "View", Some("Edit"))?;
    view.insert(&items.pin_explorer, 0)?;
    view.insert(&items.move_explorer, 1)?;
    view.insert(&PredefinedMenuItem::separator(app)?, 2)?;
    view.insert(&items.show_pages, 3)?;
    view.insert(&PredefinedMenuItem::separator(app)?, 4)?;

    app.manage(items);
    Ok(menu)
}

/// The default menu differs per platform (e.g. Linux has no File menu, only macOS has View).
fn find_or_add_submenu(
    app: &AppHandle,
    menu: &Menu<Wry>,
    title: &str,
    after: Option<&str>,
) -> tauri::Result<Submenu<Wry>> {
    let submenus: Vec<Submenu<Wry>> = menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .collect();
    let position_of = |name: &str| submenus.iter().position(|s| s.text().is_ok_and(|t| t == name));

    if let Some(index) = position_of(title) {
        return Ok(submenus[index].clone());
    }
    let submenu = Submenu::new(app, title, true)?;
    let position = after.and_then(position_of).map_or(0, |index| index + 1);
    menu.insert(&submenu, position)?;
    Ok(submenu)
}

pub fn handle_event(app: &AppHandle, id: &str) {
    if let Some(action) = ACTIONS.into_iter().find(|action| *action == id) {
        let _ = app.emit("menu", action);
    }
}

pub fn set_workspace_open(app: &AppHandle, open: bool) {
    if let Some(items) = app.try_state::<WorkspaceItems>() {
        let _ = items.new_note.set_enabled(open);
        let _ = items.new_markdown_note.set_enabled(open);
        let _ = items.close.set_enabled(open);
        let _ = items.pin_explorer.set_enabled(open);
        let _ = items.move_explorer.set_enabled(open);
        let _ = items.show_pages.set_enabled(open);
    }
}

/// Keeps the menu's check mark in sync with the explorer.
pub fn set_explorer_pinned(app: &AppHandle, pinned: bool) {
    if let Some(items) = app.try_state::<WorkspaceItems>() {
        let _ = items.pin_explorer.set_checked(pinned);
    }
}

/// Keeps the menu's check mark in sync with the page view.
pub fn set_showing_pages(app: &AppHandle, showing: bool) {
    if let Some(items) = app.try_state::<WorkspaceItems>() {
        let _ = items.show_pages.set_checked(showing);
    }
}
