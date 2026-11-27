pub mod assets;
pub mod completions;
pub mod external;
pub mod files;
pub mod folders;
pub mod layout;
pub mod links;
pub mod maths;
mod menu;
pub mod notes;
pub mod page_settings;
pub mod pages;
pub mod problems;
pub mod properties;
pub mod search;
pub mod slash;
pub mod tables;
mod typst_world;
pub mod watch;
pub mod workspace;
pub mod zotero;

use files::FileEntry;
use layout::{ExplorerLayout, ExplorerMode};
use notes::{NoteError, NoteFormat, RenameError};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use workspace::{Settings, Workspace, WorkspaceError};

/// The open note drawn as pages, kept so clicks on its pages can be traced back to its text.
#[derive(Default)]
struct OpenPages(Mutex<Option<pages::Pages>>);

/// The folder of the workspace that's open right now, if any.
#[derive(Default)]
struct CurrentWorkspace(Mutex<Option<PathBuf>>);

impl CurrentWorkspace {
    fn set(&self, path: Option<PathBuf>) {
        *self.0.lock().unwrap() = path;
    }

    fn path(&self) -> Result<PathBuf, String> {
        self.0.lock().unwrap().clone().ok_or_else(|| "No workspace is open.".into())
    }
}

fn settings(app: &AppHandle) -> Settings {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    Settings::at(config_dir.join("settings.json"))
}

/// Watches the open workspace's folder, telling the window ("files-changed") when files come and go.
#[derive(Default)]
struct WorkspaceWatcher(Mutex<Option<Box<dyn std::any::Any + Send>>>);

fn mark_open(app: &AppHandle, current: &CurrentWorkspace, workspace: Option<&Workspace>) {
    current.set(workspace.map(|w| w.path.clone()));
    menu::set_workspace_open(app, workspace.is_some());
    // Watch the new workspace (the old one's watcher stops when dropped).
    let watcher = workspace.and_then(|w| {
        let app = app.clone();
        watch::watch_workspace(&w.path, move || {
            use tauri::Emitter;
            let _ = app.emit("files-changed", ());
        })
        .ok()
        .map(|watcher| Box::new(watcher) as Box<dyn std::any::Any + Send>)
    });
    if let Some(state) = app.try_state::<WorkspaceWatcher>() {
        *state.0.lock().unwrap() = watcher;
    }
}

#[tauri::command]
fn get_last_workspace(app: AppHandle, current: State<CurrentWorkspace>) -> Option<Workspace> {
    let workspace = workspace::restore_last_workspace(&settings(&app));
    mark_open(&app, &current, workspace.as_ref());
    workspace
}

#[tauri::command]
fn open_workspace(
    app: AppHandle,
    current: State<CurrentWorkspace>,
    path: String,
) -> Result<Workspace, WorkspaceError> {
    let workspace = workspace::open_and_remember(Path::new(&path), &settings(&app))?;
    mark_open(&app, &current, Some(&workspace));
    Ok(workspace)
}

#[tauri::command]
fn close_workspace(app: AppHandle, current: State<CurrentWorkspace>) -> Result<(), WorkspaceError> {
    workspace::close_workspace(&settings(&app))?;
    mark_open(&app, &current, None);
    Ok(())
}

#[tauri::command]
fn get_recent_workspaces(app: AppHandle) -> Vec<Workspace> {
    workspace::recent_workspaces(&settings(&app))
}

#[tauri::command]
fn list_files(current: State<CurrentWorkspace>) -> Result<Vec<FileEntry>, String> {
    files::list_files(&current.path()?).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_explorer_layout(
    app: AppHandle,
    current: State<CurrentWorkspace>,
) -> Result<ExplorerLayout, String> {
    let layout = layout::load_explorer_layout(&current.path()?);
    menu::set_explorer_pinned(&app, layout.mode == ExplorerMode::Pinned);
    Ok(layout)
}

#[tauri::command]
fn save_explorer_layout(
    app: AppHandle,
    current: State<CurrentWorkspace>,
    layout: ExplorerLayout,
) -> Result<(), String> {
    layout::save_explorer_layout(&current.path()?, &layout).map_err(|e| e.to_string())?;
    menu::set_explorer_pinned(&app, layout.mode == ExplorerMode::Pinned);
    Ok(())
}

/// Creates an empty note at the top of the workspace (Typst unless another format is asked for)
/// and returns its path relative to the workspace.
#[tauri::command]
fn create_note(current: State<CurrentWorkspace>, format: Option<NoteFormat>, folder: Option<String>) -> Result<String, String> {
    notes::create_note_in(&current.path()?, format.unwrap_or_default(), folder.as_deref().unwrap_or("")).map_err(|e| e.to_string())
}

/// Creates an empty "New folder" in a folder ("" for the top); returns its path.
#[tauri::command]
fn create_folder(current: State<CurrentWorkspace>, parent: String) -> Result<String, folders::FileError> {
    let workspace = current.path().map_err(folders::FileError::Io)?;
    folders::create_folder(&workspace, &parent)
}

/// Gives a folder a new name; returns its new path.
#[tauri::command]
fn rename_folder(current: State<CurrentWorkspace>, path: String, new_name: String) -> Result<String, String> {
    folders::rename_folder(&current.path()?, &path, &new_name).map_err(|e| folders::folder_rename_message(&e))
}

/// How many files are in a folder (in all its folders).
#[tauri::command]
fn files_in_folder(current: State<CurrentWorkspace>, path: String) -> Result<usize, folders::FileError> {
    let workspace = current.path().map_err(folders::FileError::Io)?;
    folders::files_in(&workspace, &path)
}

/// Deletes a folder and what's in it by sending it to the system's Trash.
#[tauri::command]
fn delete_folder(current: State<CurrentWorkspace>, path: String) -> Result<(), folders::FileError> {
    let workspace = current.path().map_err(folders::FileError::Io)?;
    folders::delete_folder_with(&workspace, &path, |folder| trash::delete(folder).map_err(|e| std::io::Error::other(e.to_string())))
}

/// Moves a file or folder into a folder; returns its new path.
#[tauri::command]
fn move_into(current: State<CurrentWorkspace>, path: String, folder: String) -> Result<String, folders::FileError> {
    let workspace = current.path().map_err(folders::FileError::Io)?;
    folders::move_into(&workspace, &path, &folder)
}

/// Copies a file or folder into a folder; returns the copy's path.
#[tauri::command]
fn copy_into(current: State<CurrentWorkspace>, path: String, folder: String) -> Result<String, folders::FileError> {
    let workspace = current.path().map_err(folders::FileError::Io)?;
    folders::copy_into(&workspace, &path, &folder)
}

/// The notes that link to a file (like a PDF, for its annotations).
#[tauri::command]
fn notes_linking_to(current: State<CurrentWorkspace>, path: String) -> Result<Vec<String>, String> {
    Ok(links::notes_linking_to(&current.path()?, &path))
}

/// Creates an empty board (whiteboard) and returns its path relative to the workspace.
#[tauri::command]
fn create_board(current: State<CurrentWorkspace>) -> Result<String, String> {
    notes::create_board(&current.path()?).map_err(|e| e.to_string())
}

/// Creates an empty note at a path (for a link to a note that doesn't exist yet) and returns it.
#[tauri::command]
fn create_note_at(current: State<CurrentWorkspace>, path: String) -> Result<String, NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    notes::create_note_at(&workspace, &path)
}

/// Gives a note a new name (without extension), keeping its format and folder.
/// Returns its new path relative to the workspace.
#[tauri::command]
fn rename_note(
    current: State<CurrentWorkspace>,
    path: String,
    new_name: String,
) -> Result<String, RenameError> {
    let workspace = current.path().map_err(RenameError::Io)?;
    notes::rename_note(&workspace, &path, &new_name)
}

/// What's written in a note (path relative to the workspace).
#[tauri::command]
fn read_note(current: State<CurrentWorkspace>, path: String) -> Result<String, NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    notes::read_note(&workspace, &path)
}

/// Replaces what's written in a note.
#[tauri::command]
fn save_note(
    current: State<CurrentWorkspace>,
    path: String,
    contents: String,
) -> Result<(), NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    notes::save_note(&workspace, &path, &contents)
}

/// Draws a piece of maths (with its dollars) as an SVG picture, using the Typst compiler.
/// Async, so drawing never blocks the window.
#[tauri::command]
async fn render_maths(maths: String) -> Result<String, String> {
    maths::render_maths(&maths)
}

/// Undoes creating a note: removes it, but only while it's still empty.
#[tauri::command]
fn remove_empty_note(current: State<CurrentWorkspace>, path: String) -> Result<(), NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    notes::remove_empty_note(&workspace, &path)
}

/// Deletes a file (path relative to the workspace) by sending it to the system's Trash.
#[tauri::command]
fn delete_file(current: State<CurrentWorkspace>, path: String) -> Result<(), NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    notes::delete_file_with(&workspace, &path, |file| {
        trash::delete(file).map_err(|e| std::io::Error::other(e.to_string()))
    })
}

/// The lines of the workspace's notes with some text in them. Async, so it never blocks the window.
#[tauri::command]
async fn search_notes(current: State<'_, CurrentWorkspace>, query: String) -> Result<Vec<search::TextMatch>, String> {
    Ok(search::search_notes(&current.path()?, &query))
}

/// The links between the workspace's notes, for the graph view.
#[tauri::command]
async fn note_links(current: State<'_, CurrentWorkspace>) -> Result<Vec<links::NoteLink>, String> {
    Ok(links::note_links(&current.path()?))
}

#[tauri::command]
async fn zotero_papers_with_annotations(current: State<'_, CurrentWorkspace>) -> Result<Vec<String>, String> {
    Ok(links::zotero_papers_with_annotations(&current.path()?))
}

/// Saves a pasted (or dropped) image in the workspace's `assets` folder; returns its path there.
/// The image comes as the request's raw body, its name in the "name" header.
#[tauri::command]
fn save_asset(current: State<CurrentWorkspace>, request: tauri::ipc::Request) -> Result<String, NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(NoteError::Io("No image was sent.".into()));
    };
    let name = request.headers().get("name").and_then(|v| v.to_str().ok()).unwrap_or("image.png");
    assets::save_asset(&workspace, &percent_decode(name), bytes)
}

/// Header values are plain ASCII: names are sent percent-encoded.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match (bytes[i], text.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Watches the Zotero library once it's been read, telling the window ("zotero-changed") when it
/// changes, so it's always the same as in Zotero.
#[derive(Default)]
struct ZoteroWatcher(Mutex<Option<(PathBuf, Box<dyn std::any::Any + Send>)>>);

/// The user's Zotero library (read from a copy of its database), or none if Zotero isn't on this
/// computer. From then on, changes to it are told ("zotero-changed"). Async: reading it never
/// blocks the window.
#[tauri::command]
async fn zotero_library(app: AppHandle, watcher: State<'_, ZoteroWatcher>) -> Result<Option<zotero::ZoteroLibrary>, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let Some(data) = zotero::find_zotero(&home) else { return Ok(None) };
    {
        let mut watching = watcher.0.lock().unwrap();
        if watching.as_ref().is_none_or(|(folder, _)| *folder != data) {
            let app = app.clone();
            let watcher = zotero::watch_library(&data, move || {
                use tauri::Emitter;
                let _ = app.emit("zotero-changed", ());
            });
            *watching = Some((data.clone(), Box::new(watcher)));
        }
    }
    zotero::read_library(&data).map(Some)
}

/// A Zotero paper's PDF (the paper's id, as in the library), as raw bytes for the PDF reader.
#[tauri::command]
async fn read_zotero_pdf(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let data = zotero::find_zotero(&home).ok_or("Zotero isn't on this computer.")?;
    Ok(tauri::ipc::Response::new(zotero::read_pdf(&data, &id)?))
}

/// A file in the workspace, as raw bytes (for images in the editor and the PDF reader).
#[tauri::command]
async fn read_workspace_file(current: State<'_, CurrentWorkspace>, path: String) -> Result<tauri::ipc::Response, NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    Ok(tauri::ipc::Response::new(assets::read_workspace_file(&workspace, &path)?))
}

/// Opens a website (or email address) from a link, in the browser (or mail app).
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = external::checked_url(&url)?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Closes the app's window (⌘W with no tab open): the app quits.
#[tauri::command]
fn close_window(app: AppHandle) {
    menu::close_window(&app);
}

/// Opens a workspace file from a link in its own app (for files the app doesn't show itself).
#[tauri::command]
fn open_file(app: AppHandle, current: State<CurrentWorkspace>, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let file = external::checked_file(&current.path()?, &path)?;
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// How the editor behaves (app-wide settings).
/// Shows or hides the window's buttons (close, minimise, zoom) on a Mac: hidden while the sidebar
/// is auto-hidden on the left, out of view, they come with it, like in Zen. With `fade`, they fade
/// in once it's slid in (it takes 200ms), and out as it starts to leave; without, they just show
/// or hide.
#[tauri::command]
fn show_window_buttons(window: tauri::WebviewWindow, shown: bool, fade: Option<bool>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    window_buttons::show(&window, shown, fade.unwrap_or(false))?;
    #[cfg(not(target_os = "macos"))]
    let _ = (window, shown, fade);
    Ok(())
}

#[cfg(target_os = "macos")]
mod window_buttons {
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSButton, NSWindow, NSWindowButton};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::Duration;

    /// How long the sidebar takes to slide in (see FileExplorer.tsx): they fade in after it.
    const SLIDE: Duration = Duration::from_millis(200);
    /// How long they take to fade in or out, in seconds.
    const FADE: f64 = 0.12;
    /// Counts changes: a later step (fading in after the slide, hiding after fading out) only
    /// happens if nothing changed since.
    static CHANGES: AtomicU64 = AtomicU64::new(0);
    /// Whether the app wants them shown (the sidebar's say): in full screen, they're always the
    /// system's to show (moving to the screen's top brings them, with the menu bar).
    static WANTED: AtomicBool = AtomicBool::new(true);

    fn full_screen(window: &tauri::WebviewWindow) -> bool {
        window.is_fullscreen().unwrap_or(false)
    }

    fn set_hidden(window: &tauri::WebviewWindow, hidden: bool) {
        for button in buttons_of(window) {
            button.setAlphaValue(1.0);
            button.setHidden(hidden);
        }
    }

    /// After the window went full screen or back: shown in full screen, as the app wants otherwise.
    pub fn refresh(window: &tauri::WebviewWindow) {
        CHANGES.fetch_add(1, Ordering::SeqCst);
        set_hidden(window, !WANTED.load(Ordering::SeqCst) && !full_screen(window));
    }

    fn buttons_of(window: &tauri::WebviewWindow) -> Vec<objc2::rc::Retained<NSButton>> {
        let Ok(pointer) = window.ns_window() else { return Vec::new() };
        // SAFETY: Tauri's NSWindow for this window, used on the main thread while it's open.
        let ns_window = unsafe { &*(pointer as *const NSWindow) };
        [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton]
            .into_iter()
            .filter_map(|kind| ns_window.standardWindowButton(kind))
            .collect()
    }

    /// Runs `then` on the main thread after `wait`, unless something changed meanwhile.
    fn later(window: &tauri::WebviewWindow, change: u64, wait: Duration, then: impl FnOnce(&tauri::WebviewWindow) + Send + 'static) {
        let window = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(wait);
            let target = window.clone();
            let _ = window.run_on_main_thread(move || {
                if CHANGES.load(Ordering::SeqCst) == change {
                    then(&target);
                }
            });
        });
    }

    fn fade_to(window: &tauri::WebviewWindow, alpha: f64) {
        NSAnimationContext::beginGrouping();
        NSAnimationContext::currentContext().setDuration(FADE);
        for button in buttons_of(window) {
            button.animator().setAlphaValue(alpha);
        }
        NSAnimationContext::endGrouping();
    }

    pub fn show(window: &tauri::WebviewWindow, shown: bool, fade: bool) -> Result<(), String> {
        let change = CHANGES.fetch_add(1, Ordering::SeqCst) + 1;
        WANTED.store(shown, Ordering::SeqCst);
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                if full_screen(&target) {
                    set_hidden(&target, false);
                    return;
                }
                let buttons = buttons_of(&target);
                if !fade {
                    for button in &buttons {
                        button.setAlphaValue(1.0);
                        button.setHidden(!shown);
                    }
                } else if shown {
                    // Once the sidebar has slid in under them.
                    later(&target, change, SLIDE, |window| {
                        for button in buttons_of(window) {
                            button.setAlphaValue(0.0);
                            button.setHidden(false);
                        }
                        fade_to(window, 1.0);
                    });
                } else {
                    // As it starts to leave; then hidden, so they can't be clicked.
                    fade_to(&target, 0.0);
                    later(&target, change, Duration::from_secs_f64(FADE + 0.02), |window| {
                        set_hidden(window, !full_screen(window));
                    });
                }
            })
            .map_err(|e| e.to_string())
    }
}

/// The sidebar's width and how its height is shared, the same in every workspace.
#[tauri::command]
fn get_sidebar_sizes(app: AppHandle) -> workspace::SidebarSizes {
    workspace::sidebar_sizes(&settings(&app))
}

#[tauri::command]
fn save_sidebar_sizes(app: AppHandle, sizes: workspace::SidebarSizes) -> Result<(), String> {
    workspace::save_sidebar_sizes(&settings(&app), &sizes).map_err(|e| e.to_string())
}

/// What's hidden in the sidebar's Library, in the open workspace.
#[tauri::command]
fn get_hidden_in_library(current: State<CurrentWorkspace>) -> Vec<String> {
    current.path().map(|path| layout::load_hidden_in_library(&path)).unwrap_or_default()
}

#[tauri::command]
fn save_hidden_in_library(current: State<CurrentWorkspace>, hidden: Vec<String>) -> Result<(), String> {
    layout::save_hidden_in_library(&current.path()?, &hidden).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_open_folders(current: State<CurrentWorkspace>) -> Vec<String> {
    current.path().map(|path| layout::load_open_folders(&path)).unwrap_or_default()
}

#[tauri::command]
fn save_open_folders(current: State<CurrentWorkspace>, open: Vec<String>) -> Result<(), String> {
    layout::save_open_folders(&current.path()?, &open).map_err(|e| e.to_string())
}

/// Which libraries and collections are open in the sidebar's Library (none: never changed).
#[tauri::command]
fn get_open_in_library(current: State<CurrentWorkspace>) -> Option<Vec<String>> {
    current.path().ok().and_then(|path| layout::load_open_in_library(&path))
}

#[tauri::command]
fn save_open_in_library(current: State<CurrentWorkspace>, open: Vec<String>) -> Result<(), String> {
    layout::save_open_in_library(&current.path()?, &open).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_editor_settings(app: AppHandle) -> workspace::EditorSettings {
    workspace::editor_settings(&settings(&app))
}

#[tauri::command]
fn save_editor_settings(app: AppHandle, editor: workspace::EditorSettings) -> Result<(), String> {
    workspace::save_editor_settings(&settings(&app), &editor).map_err(|e| e.to_string())
}

/// Redoes creating a note: brings it back, empty, at the same place.
#[tauri::command]
fn restore_empty_note(current: State<CurrentWorkspace>, path: String) -> Result<(), NoteError> {
    let workspace = current.path().map_err(NoteError::Io)?;
    notes::restore_empty_note(&workspace, &path)
}

/// The properties in a note's properties block (the `---` or `#metadata` block at its top).
#[tauri::command]
async fn parse_properties(
    format: NoteFormat,
    block: String,
) -> Result<Vec<properties::Property>, String> {
    properties::parse_block(&block, format)
}

/// The properties block for these properties (empty when there are none). Unchanged
/// properties keep exactly how they were written.
#[tauri::command]
async fn write_properties(format: NoteFormat, properties: Vec<properties::Property>) -> String {
    properties::write_block(&properties, format)
}

/// A Typst note's page settings (paper, columns, margins, font…), and which are left to its code.
#[tauri::command]
async fn read_page_settings(note: String) -> page_settings::ReadPageSettings {
    page_settings::read_page_settings(&note)
}

/// The note with one page setting changed in its `#set` rules.
#[tauri::command]
async fn change_page_setting(
    note: String,
    setting: page_settings::PageSetting,
) -> Result<String, String> {
    page_settings::change_page_setting(&note, setting)
}

/// Every font a note can use: Typst's own, then the computer's.
#[tauri::command]
async fn list_fonts() -> Vec<String> {
    page_settings::font_families()
}

/// Suggestions while writing Typst, at a cursor position (counted like the editor counts).
#[tauri::command]
async fn complete_typst(
    note: String,
    cursor: usize,
    explicit: bool,
) -> Option<completions::Suggestions> {
    completions::complete(&note, cursor, explicit)
}

/// Property names (with their usual type and values) used in the workspace, for suggestions.
#[tauri::command]
async fn suggest_properties(
    current: State<'_, CurrentWorkspace>,
) -> Result<Vec<properties::KnownProperty>, String> {
    Ok(properties::suggest_properties(&current.path()?))
}

/// The mistakes in a Typst note, explained, with fixes.
#[tauri::command]
async fn check_note(current: State<'_, CurrentWorkspace>, note: String, path: Option<String>) -> Result<Vec<problems::Problem>, String> {
    // A note in the open workspace can use its files (like images).
    Ok(match (path, current.path()) {
        (Some(path), Ok(workspace)) => problems::check_note_at(&note, &workspace, &path),
        _ => problems::check_note(&note),
    })
}

/// The "/" menu's commands for a note format.
#[tauri::command]
fn slash_commands(format: NoteFormat) -> Vec<slash::SlashCommand> {
    slash::slash_commands(format)
}

/// Whether Typst notes are shown as pages next to the editor in this workspace.
#[tauri::command]
fn get_show_pages(app: AppHandle, current: State<CurrentWorkspace>) -> Result<bool, String> {
    let show = layout::load_show_pages(&current.path()?);
    menu::set_showing_pages(&app, show);
    Ok(show)
}

#[tauri::command]
fn save_show_pages(
    app: AppHandle,
    current: State<CurrentWorkspace>,
    show: bool,
) -> Result<(), String> {
    layout::save_show_pages(&current.path()?, show).map_err(|e| e.to_string())?;
    menu::set_showing_pages(&app, show);
    Ok(())
}

/// Draws a Typst note as pages. Async, so drawing never blocks the window.
#[tauri::command]
async fn render_pages(
    open: State<'_, OpenPages>,
    current: State<'_, CurrentWorkspace>,
    note: String,
    path: Option<String>,
) -> Result<Vec<pages::PagePicture>, String> {
    let drawn = match (path, current.path()) {
        (Some(path), Ok(workspace)) => pages::render_pages_at(&note, &workspace, &path)?,
        _ => pages::render_pages(&note)?,
    };
    let pictures = drawn.pictures();
    *open.0.lock().unwrap() = Some(drawn);
    Ok(pictures)
}

/// Exports a Typst note as a PDF file at `destination` (a full path, chosen in a Save dialog).
/// Async, so exporting never blocks the window.
#[tauri::command]
async fn export_pdf(
    current: State<'_, CurrentWorkspace>,
    note: String,
    path: Option<String>,
    destination: String,
) -> Result<(), String> {
    let drawn = match (path, current.path()) {
        (Some(path), Ok(workspace)) => pages::render_pages_at(&note, &workspace, &path)?,
        _ => pages::render_pages(&note)?,
    };
    drawn.save_pdf(std::path::Path::new(&destination))
}

/// Where in the note's text a click on one of its pages lands (in points from the page's top left).
#[tauri::command]
fn page_position(open: State<OpenPages>, page: usize, x: f64, y: f64) -> Option<usize> {
    open.0.lock().unwrap().as_ref()?.position_at(page, x, y)
}

/// Where the note last drawn as pages has its text on them (for scrolling the two together).
#[tauri::command]
fn page_places(open: State<OpenPages>) -> Vec<pages::Place> {
    open.0.lock().unwrap().as_ref().map(|drawn| drawn.places()).unwrap_or_default()
}

/// Draws a table, figure or grid (as written in the note) as an SVG picture for the writing view.
#[tauri::command]
async fn render_block(block: String) -> Result<String, String> {
    maths::render_block(&block)
}

/// A table's cells, as the table editor shows them.
#[tauri::command]
fn read_table(block: String) -> Result<tables::TableCells, String> {
    tables::read_table(&block)
}

/// A table's size, header, caption, and the cell the cursor is in (cursor counted like the editor).
#[tauri::command]
fn table_info(block: String, cursor: usize) -> Result<tables::TableInfo, String> {
    tables::table_info(&block, cursor)
}

/// The table with one change made (a row, a column, the header, the caption), and where the cursor goes.
#[tauri::command]
fn edit_table(block: String, cursor: usize, action: tables::TableAction) -> Result<tables::EditedTable, String> {
    tables::edit_table(&block, cursor, action)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(WorkspaceWatcher::default())
        .manage(ZoteroWatcher::default())
        .plugin(tauri_plugin_dialog::init())
        .manage(CurrentWorkspace::default())
        .manage(OpenPages::default())
        .setup(|app| {
            // Finding the computer's fonts takes a moment: do it now, before the first drawing.
            std::thread::spawn(page_settings::font_families);
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| menu::handle_event(app, event.id().as_ref()))
        // Going full screen or back: the window's buttons are the system's there, the app's again after.
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let (tauri::WindowEvent::Resized(_), Some(webview)) = (event, window.app_handle().get_webview_window(window.label())) {
                window_buttons::refresh(&webview);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            get_last_workspace,
            open_workspace,
            close_workspace,
            get_recent_workspaces,
            list_files,
            get_explorer_layout,
            save_explorer_layout,
            create_note,
            create_note_at,
            create_folder,
            rename_folder,
            files_in_folder,
            delete_folder,
            move_into,
            copy_into,
            get_open_folders,
            save_open_folders,
            get_open_in_library,
            save_open_in_library,
            create_board,
            notes_linking_to,
            rename_note,
            read_note,
            save_note,
            render_maths,
            get_show_pages,
            save_show_pages,
            render_pages,
            page_position,
            page_places,
            export_pdf,
            remove_empty_note,
            restore_empty_note,
            delete_file,
            search_notes,
            note_links,
            zotero_papers_with_annotations,
            save_asset,
            open_url,
            close_window,
            open_file,
            read_workspace_file,
            zotero_library,
            read_zotero_pdf,
            get_editor_settings,
            get_sidebar_sizes,
            show_window_buttons,
            save_sidebar_sizes,
            get_hidden_in_library,
            save_hidden_in_library,
            save_editor_settings,
            parse_properties,
            write_properties,
            read_page_settings,
            change_page_setting,
            list_fonts,
            complete_typst,
            suggest_properties,
            check_note,
            slash_commands,
            render_block,
            table_info,
            edit_table,
            read_table
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
