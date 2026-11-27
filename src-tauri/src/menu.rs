//! The native app menu: the platform's default menu plus the app's own items.
//! Clicking one sends a "menu" event to the frontend with the action's id (see `onMenuAction` in src/api.ts).

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};

const NEW_NOTE: &str = "new-note";
const NEW_MARKDOWN_NOTE: &str = "new-markdown-note";
const NEW_BOARD: &str = "new-board";
const CLOSE_WORKSPACE: &str = "close-workspace";
const TOGGLE_EXPLORER_PINNED: &str = "toggle-explorer-pinned";
const MOVE_EXPLORER_TO_OTHER_SIDE: &str = "move-explorer-to-other-side";
const TOGGLE_PAGES: &str = "toggle-pages";
const UNDO: &str = "undo";
const REDO: &str = "redo";
const SHOW_SUGGESTIONS: &str = "show-suggestions";
const OPEN_SETTINGS: &str = "open-settings";
const GO_TO_FILE: &str = "go-to-file";
const COMMAND_PALETTE: &str = "command-palette";
const GRAPH_VIEW: &str = "graph-view";
const CLOSE_PANE: &str = "close-pane";
const EXPORT_PDF: &str = "export-pdf";
const CLOSE_TAB: &str = "close-tab";
const TOGGLE_CODE: &str = "toggle-code";
const CLOSE_WINDOW: &str = "close-window";

const ACTIONS: [&str; 18] = [
    NEW_NOTE,
    NEW_MARKDOWN_NOTE,
    NEW_BOARD,
    CLOSE_WORKSPACE,
    TOGGLE_EXPLORER_PINNED,
    MOVE_EXPLORER_TO_OTHER_SIDE,
    TOGGLE_PAGES,
    UNDO,
    REDO,
    SHOW_SUGGESTIONS,
    OPEN_SETTINGS,
    GO_TO_FILE,
    COMMAND_PALETTE,
    GRAPH_VIEW,
    CLOSE_PANE,
    EXPORT_PDF,
    CLOSE_TAB,
    TOGGLE_CODE,
];

/// Items that only make sense while a workspace is open.
struct WorkspaceItems {
    new_note: MenuItem<Wry>,
    new_markdown_note: MenuItem<Wry>,
    new_board: MenuItem<Wry>,
    close: MenuItem<Wry>,
    pin_explorer: CheckMenuItem<Wry>,
    move_explorer: MenuItem<Wry>,
    show_pages: CheckMenuItem<Wry>,
    show_code: MenuItem<Wry>,
    go_to_file: MenuItem<Wry>,
    command_palette: MenuItem<Wry>,
    graph_view: MenuItem<Wry>,
    close_pane: MenuItem<Wry>,
    export_pdf: MenuItem<Wry>,
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
        new_board: MenuItem::with_id(app, NEW_BOARD, "New Board", false, None::<&str>)?,
        close: MenuItem::with_id(app, CLOSE_WORKSPACE, "Close Workspace", false, None::<&str>)?,
        go_to_file: MenuItem::with_id(app, GO_TO_FILE, "Go to File…", false, Some("CmdOrCtrl+P"))?,
        command_palette: MenuItem::with_id(
            app,
            COMMAND_PALETTE,
            "Command Palette…",
            false,
            Some("CmdOrCtrl+Shift+P"),
        )?,
        graph_view: MenuItem::with_id(app, GRAPH_VIEW, "Graph View", false, Some("CmdOrCtrl+Shift+G"))?,
        close_pane: MenuItem::with_id(app, CLOSE_PANE, "Close Pane", false, None::<&str>)?,
        // A Typst note shown as code (its raw text, highlighted), or formatted again.
        show_code: MenuItem::with_id(app, TOGGLE_CODE, "Show Code", false, Some("CmdOrCtrl+Alt+C"))?,
        export_pdf: MenuItem::with_id(app, EXPORT_PDF, "Export as PDF…", false, Some("CmdOrCtrl+Shift+E"))?,
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
    file.insert(&items.new_board, 2)?;
    file.insert(&items.go_to_file, 3)?;
    file.insert(&PredefinedMenuItem::separator(app)?, 4)?;
    file.insert(&items.export_pdf, 5)?;
    file.insert(&PredefinedMenuItem::separator(app)?, 6)?;
    // ⌘W closes the shown tab (the window only when no tab is open), like VS Code: the default
    // menu's Close Window, which took ⌘W, is replaced (it's in File, and in Window too).
    for submenu in menu.items()?.into_iter().filter_map(|item| item.as_submenu().cloned()) {
        for item in submenu.items()? {
            if let Some(predefined) = item.as_predefined_menuitem() {
                if predefined.text().is_ok_and(|text| text == "Close Window" || text == "Close") {
                    submenu.remove(predefined)?;
                }
            }
        }
    }
    file.insert(&MenuItem::with_id(app, CLOSE_TAB, "Close Tab", true, Some("CmdOrCtrl+W"))?, 7)?;
    file.insert(&MenuItem::with_id(app, CLOSE_WINDOW, "Close Window", true, Some("CmdOrCtrl+Shift+W"))?, 8)?;
    file.insert(&PredefinedMenuItem::separator(app)?, 9)?;
    file.insert(&items.close, 10)?;
    file.insert(&PredefinedMenuItem::separator(app)?, 11)?;

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
    view.insert(&items.command_palette, 0)?;
    view.insert(&PredefinedMenuItem::separator(app)?, 1)?;
    view.insert(&items.pin_explorer, 2)?;
    view.insert(&items.move_explorer, 3)?;
    view.insert(&PredefinedMenuItem::separator(app)?, 4)?;
    view.insert(&items.show_pages, 5)?;
    view.insert(&items.show_code, 6)?;
    view.insert(&items.graph_view, 7)?;
    view.insert(&PredefinedMenuItem::separator(app)?, 8)?;
    view.insert(&items.close_pane, 9)?;
    view.insert(&PredefinedMenuItem::separator(app)?, 10)?;

    // Settings: in the app's own menu on a Mac (like every Mac app), in File elsewhere.
    let settings = MenuItem::with_id(app, OPEN_SETTINGS, "Settings…", true, Some("CmdOrCtrl+,"))?;
    let app_menu = menu.items()?.first().and_then(|item| item.as_submenu().cloned());
    match app_menu {
        Some(app_menu) if cfg!(target_os = "macos") => {
            app_menu.insert(&settings, 1)?;
            app_menu.insert(&PredefinedMenuItem::separator(app)?, 1)?;
        }
        _ => file.insert(&settings, 6)?,
    }

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

/// Closes the app's window: the app quits.
pub fn close_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

pub fn handle_event(app: &AppHandle, id: &str) {
    let workspace_open = app.try_state::<WorkspaceItems>().is_some_and(|items| items.close.is_enabled().unwrap_or(false));
    // Without a workspace there are no tabs: ⌘W closes the window.
    if id == CLOSE_WINDOW || (id == CLOSE_TAB && !workspace_open) {
        close_window(app);
        return;
    }
    if let Some(action) = ACTIONS.into_iter().find(|action| *action == id) {
        let _ = app.emit("menu", action);
    }
}

pub fn set_workspace_open(app: &AppHandle, open: bool) {
    if let Some(items) = app.try_state::<WorkspaceItems>() {
        let _ = items.new_note.set_enabled(open);
        let _ = items.new_markdown_note.set_enabled(open);
        let _ = items.new_board.set_enabled(open);
        let _ = items.close.set_enabled(open);
        let _ = items.show_code.set_enabled(open);
        let _ = items.pin_explorer.set_enabled(open);
        let _ = items.move_explorer.set_enabled(open);
        let _ = items.show_pages.set_enabled(open);
        let _ = items.go_to_file.set_enabled(open);
        let _ = items.command_palette.set_enabled(open);
        let _ = items.graph_view.set_enabled(open);
        let _ = items.close_pane.set_enabled(open);
        let _ = items.export_pdf.set_enabled(open);
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
