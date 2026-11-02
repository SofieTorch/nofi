//! Watching the workspace's folder, so the explorer shows files as they come and go (made in
//! Finder, by another app, or synced). Quick runs of changes are told once; changes in the app's
//! own `.marginalia` folder don't count.

use crate::workspace::APP_DATA_DIR;
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::path::Path;
use std::time::Duration;

/// Watches until the returned watcher is dropped.
pub fn watch_workspace(
    folder: &Path,
    on_change: impl Fn() + Send + 'static,
) -> notify_debouncer_mini::notify::Result<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>> {
    let app_data = folder.join(APP_DATA_DIR);
    // (The paths told may be the folder's real path, e.g. /private/var/… on a Mac.)
    let app_data_real = app_data.canonicalize().unwrap_or_else(|_| app_data.clone());
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let counts = events.iter().any(|event| !event.path.starts_with(&app_data) && !event.path.starts_with(&app_data_real));
        if counts {
            on_change();
        }
    })?;
    debouncer.watcher().watch(folder, RecursiveMode::Recursive)?;
    Ok(debouncer)
}
