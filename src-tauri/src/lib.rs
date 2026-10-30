pub mod files;
pub mod layout;
mod menu;
pub mod notes;
pub mod workspace;

use files::FileEntry;
use layout::{ExplorerLayout, ExplorerMode};
use notes::NoteFormat;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use workspace::{Settings, Workspace, WorkspaceError};

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

fn mark_open(app: &AppHandle, current: &CurrentWorkspace, workspace: Option<&Workspace>) {
    current.set(workspace.map(|w| w.path.clone()));
    menu::set_workspace_open(app, workspace.is_some());
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
fn create_note(current: State<CurrentWorkspace>, format: Option<NoteFormat>) -> Result<String, String> {
    notes::create_note(&current.path()?, format.unwrap_or_default()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CurrentWorkspace::default())
        .setup(|app| {
            let menu = menu::build(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| menu::handle_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            get_last_workspace,
            open_workspace,
            close_workspace,
            get_recent_workspaces,
            list_files,
            get_explorer_layout,
            save_explorer_layout,
            create_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
