//! Spec: choosing the folder where everything lives, and reopening it on the next launch.

use marginalia_lib::workspace::*;
use std::fs;
use tempfile::TempDir;

fn settings_in(dir: &TempDir) -> Settings {
    Settings::at(dir.path().join("settings.json"))
}

mod choosing_a_folder_as_the_workspace {
    use super::*;

    #[test]
    fn an_existing_empty_folder_can_be_used_as_a_workspace() {
        let folder = TempDir::new().unwrap();

        let workspace = open_folder(folder.path()).unwrap();

        assert_eq!(workspace.path, folder.path());
    }

    #[test]
    fn the_workspace_is_named_after_its_folder() {
        let parent = TempDir::new().unwrap();
        let folder = parent.path().join("Research Notes");
        fs::create_dir(&folder).unwrap();

        let workspace = open_folder(&folder).unwrap();

        assert_eq!(workspace.name, "Research Notes");
    }

    /// Like Obsidian's `.obsidian`: app data stays out of the way of the user's own files.
    #[test]
    fn app_data_is_kept_in_a_hidden_marginalia_folder_inside_the_workspace() {
        let folder = TempDir::new().unwrap();

        open_folder(folder.path()).unwrap();

        assert!(folder.path().join(APP_DATA_DIR).is_dir());
    }

    /// Users must be able to point the app at a folder that already holds their notes.
    #[test]
    fn existing_files_in_the_folder_are_left_untouched() {
        let folder = TempDir::new().unwrap();
        let note = folder.path().join("my note.md");
        fs::write(&note, "# Hello").unwrap();

        open_folder(folder.path()).unwrap();

        assert_eq!(fs::read_to_string(&note).unwrap(), "# Hello");
    }

    #[test]
    fn a_folder_already_used_as_a_workspace_can_be_opened_again_keeping_its_app_data() {
        let folder = TempDir::new().unwrap();
        open_folder(folder.path()).unwrap();
        let app_data_file = folder.path().join(APP_DATA_DIR).join("something.json");
        fs::write(&app_data_file, "{}").unwrap();

        open_folder(folder.path()).unwrap();

        assert!(app_data_file.exists());
    }

    #[test]
    fn a_folder_that_does_not_exist_is_rejected() {
        let parent = TempDir::new().unwrap();
        let missing = parent.path().join("missing");

        let result = open_folder(&missing);

        assert_eq!(result, Err(WorkspaceError::NotFound(missing)));
    }

    #[test]
    fn a_file_is_rejected_because_a_workspace_must_be_a_folder() {
        let parent = TempDir::new().unwrap();
        let file = parent.path().join("paper.pdf");
        fs::write(&file, "").unwrap();

        let result = open_folder(&file);

        assert_eq!(result, Err(WorkspaceError::NotAFolder(file)));
    }
}

mod remembering_the_workspace_between_launches {
    use super::*;

    #[test]
    fn on_first_launch_there_is_no_workspace_to_reopen() {
        let config = TempDir::new().unwrap();

        assert_eq!(restore_last_workspace(&settings_in(&config)), None);
    }

    #[test]
    fn the_last_opened_workspace_is_reopened_on_next_launch() {
        let config = TempDir::new().unwrap();
        let folder = TempDir::new().unwrap();
        let opened = open_and_remember(folder.path(), &settings_in(&config)).unwrap();

        let restored = restore_last_workspace(&settings_in(&config));

        assert_eq!(restored, Some(opened));
    }

    #[test]
    fn the_most_recently_opened_workspace_wins_when_several_were_opened() {
        let config = TempDir::new().unwrap();
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        open_and_remember(first.path(), &settings_in(&config)).unwrap();
        open_and_remember(second.path(), &settings_in(&config)).unwrap();

        let restored = restore_last_workspace(&settings_in(&config)).unwrap();

        assert_eq!(restored.path, second.path());
    }

    /// The user is asked to pick a folder again instead of opening an empty, broken workspace.
    #[test]
    fn a_remembered_workspace_whose_folder_was_moved_or_deleted_is_not_reopened() {
        let config = TempDir::new().unwrap();
        let folder = TempDir::new().unwrap();
        open_and_remember(folder.path(), &settings_in(&config)).unwrap();
        fs::remove_dir_all(folder.path()).unwrap();

        assert_eq!(restore_last_workspace(&settings_in(&config)), None);
    }

    #[test]
    fn a_folder_that_failed_to_open_is_not_remembered() {
        let config = TempDir::new().unwrap();
        let good = TempDir::new().unwrap();
        open_and_remember(good.path(), &settings_in(&config)).unwrap();

        let _ = open_and_remember(&good.path().join("missing"), &settings_in(&config));

        let restored = restore_last_workspace(&settings_in(&config)).unwrap();
        assert_eq!(restored.path, good.path());
    }

    /// A damaged settings file should never stop the app from starting.
    #[test]
    fn a_corrupted_settings_file_is_treated_like_a_first_launch() {
        let config = TempDir::new().unwrap();
        fs::write(config.path().join("settings.json"), "not json {{{").unwrap();

        assert_eq!(restore_last_workspace(&settings_in(&config)), None);
    }

    /// On a fresh install the OS config folder for the app may not exist yet.
    #[test]
    fn the_settings_folder_is_created_if_it_does_not_exist_yet() {
        let config = TempDir::new().unwrap();
        let settings = Settings::at(config.path().join("not-yet-created").join("settings.json"));
        let folder = TempDir::new().unwrap();

        open_and_remember(folder.path(), &settings).unwrap();

        assert!(restore_last_workspace(&settings).is_some());
    }
}

mod closing_the_workspace {
    use super::*;

    #[test]
    fn after_closing_the_workspace_the_next_launch_asks_for_a_folder_again() {
        let config = TempDir::new().unwrap();
        let folder = TempDir::new().unwrap();
        open_and_remember(folder.path(), &settings_in(&config)).unwrap();

        close_workspace(&settings_in(&config)).unwrap();

        assert_eq!(restore_last_workspace(&settings_in(&config)), None);
    }

    #[test]
    fn a_closed_workspace_is_still_offered_as_a_recent_workspace() {
        let config = TempDir::new().unwrap();
        let folder = TempDir::new().unwrap();
        let opened = open_and_remember(folder.path(), &settings_in(&config)).unwrap();

        close_workspace(&settings_in(&config)).unwrap();

        assert_eq!(recent_workspaces(&settings_in(&config)), vec![opened]);
    }

    #[test]
    fn closing_the_workspace_leaves_its_files_untouched() {
        let config = TempDir::new().unwrap();
        let folder = TempDir::new().unwrap();
        let note = folder.path().join("my note.md");
        fs::write(&note, "# Hello").unwrap();
        open_and_remember(folder.path(), &settings_in(&config)).unwrap();

        close_workspace(&settings_in(&config)).unwrap();

        assert_eq!(fs::read_to_string(&note).unwrap(), "# Hello");
    }
}

mod listing_recent_workspaces {
    use super::*;

    fn paths_of(workspaces: Vec<Workspace>) -> Vec<std::path::PathBuf> {
        workspaces.into_iter().map(|w| w.path).collect()
    }

    #[test]
    fn there_are_no_recent_workspaces_on_first_launch() {
        let config = TempDir::new().unwrap();

        assert!(recent_workspaces(&settings_in(&config)).is_empty());
    }

    #[test]
    fn recent_workspaces_are_listed_most_recently_opened_first() {
        let config = TempDir::new().unwrap();
        let older = TempDir::new().unwrap();
        let newer = TempDir::new().unwrap();
        open_and_remember(older.path(), &settings_in(&config)).unwrap();
        open_and_remember(newer.path(), &settings_in(&config)).unwrap();

        let recent = paths_of(recent_workspaces(&settings_in(&config)));

        assert_eq!(recent, vec![newer.path(), older.path()]);
    }

    #[test]
    fn reopening_a_workspace_moves_it_to_the_top_instead_of_listing_it_twice() {
        let config = TempDir::new().unwrap();
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        open_and_remember(first.path(), &settings_in(&config)).unwrap();
        open_and_remember(second.path(), &settings_in(&config)).unwrap();
        open_and_remember(first.path(), &settings_in(&config)).unwrap();

        let recent = paths_of(recent_workspaces(&settings_in(&config)));

        assert_eq!(recent, vec![first.path(), second.path()]);
    }

    /// Offering a folder that no longer exists would only lead to an error.
    #[test]
    fn workspaces_whose_folder_was_moved_or_deleted_are_not_listed() {
        let config = TempDir::new().unwrap();
        let kept = TempDir::new().unwrap();
        let deleted = TempDir::new().unwrap();
        open_and_remember(kept.path(), &settings_in(&config)).unwrap();
        open_and_remember(deleted.path(), &settings_in(&config)).unwrap();
        fs::remove_dir_all(deleted.path()).unwrap();

        let recent = paths_of(recent_workspaces(&settings_in(&config)));

        assert_eq!(recent, vec![kept.path()]);
    }

    #[test]
    fn folders_that_failed_to_open_are_not_listed() {
        let config = TempDir::new().unwrap();
        let parent = TempDir::new().unwrap();
        let file = parent.path().join("paper.pdf");
        fs::write(&file, "").unwrap();

        let _ = open_and_remember(&file, &settings_in(&config));

        assert!(recent_workspaces(&settings_in(&config)).is_empty());
    }

    #[test]
    fn only_the_most_recent_workspaces_are_kept_so_the_list_stays_short() {
        let config = TempDir::new().unwrap();
        let folders: Vec<TempDir> = (0..MAX_RECENT_WORKSPACES + 2)
            .map(|_| TempDir::new().unwrap())
            .collect();
        for folder in &folders {
            open_and_remember(folder.path(), &settings_in(&config)).unwrap();
        }

        let recent = paths_of(recent_workspaces(&settings_in(&config)));

        assert_eq!(recent.len(), MAX_RECENT_WORKSPACES);
        assert_eq!(recent[0], folders.last().unwrap().path());
    }
}

/// App-wide editor settings, like whether blocks show handles to drag them.
mod editor_settings {
    use super::*;

    #[test]
    fn block_handles_are_shown_by_default() {
        let dir = TempDir::new().unwrap();

        assert!(editor_settings(&settings_in(&dir)).block_handles);
    }

    #[test]
    fn a_change_is_remembered() {
        let dir = TempDir::new().unwrap();

        save_editor_settings(&settings_in(&dir), &EditorSettings { block_handles: false, ..Default::default() }).unwrap();

        assert!(!editor_settings(&settings_in(&dir)).block_handles);
    }

    #[test]
    fn boards_have_a_plain_background_by_default_and_a_choice_is_remembered() {
        let dir = TempDir::new().unwrap();
        assert_eq!(editor_settings(&settings_in(&dir)).board_background, BoardBackground::Plain);

        let chosen = EditorSettings { board_background: BoardBackground::Grid, ..Default::default() };
        save_editor_settings(&settings_in(&dir), &chosen).unwrap();

        assert_eq!(editor_settings(&settings_in(&dir)).board_background, BoardBackground::Grid);
    }

    #[test]
    fn settings_saved_before_boards_existed_still_load() {
        let dir = TempDir::new().unwrap();
        save_editor_settings(&settings_in(&dir), &EditorSettings { block_handles: false, ..Default::default() }).unwrap();
        let file = fs::read_dir(dir.path()).unwrap().next().unwrap().unwrap().path();
        let mut json: serde_json::Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        json["editor"].as_object_mut().unwrap().remove("boardBackground");
        fs::write(&file, json.to_string()).unwrap();

        let loaded = editor_settings(&settings_in(&dir));

        assert!(!loaded.block_handles);
        assert_eq!(loaded.board_background, BoardBackground::Plain);
    }

    #[test]
    fn saving_them_keeps_the_last_workspace() {
        let dir = TempDir::new().unwrap();
        let folder = TempDir::new().unwrap();
        open_and_remember(folder.path(), &settings_in(&dir)).unwrap();

        save_editor_settings(&settings_in(&dir), &EditorSettings { block_handles: false, ..Default::default() }).unwrap();

        assert_eq!(restore_last_workspace(&settings_in(&dir)).unwrap().path, folder.path());
    }
}

/// The sidebar's width and how its height is shared between its sections: the same in every
/// workspace.
mod sidebar_sizes {
    use super::*;

    #[test]
    fn the_sidebar_starts_256_pixels_wide_shared_evenly() {
        let dir = TempDir::new().unwrap();

        assert_eq!(sidebar_sizes(&settings_in(&dir)), SidebarSizes { width: 256.0, files_share: 0.5 });
    }

    #[test]
    fn a_change_is_remembered_in_every_workspace() {
        let dir = TempDir::new().unwrap();
        let wider = SidebarSizes { width: 340.0, files_share: 0.3 };

        save_sidebar_sizes(&settings_in(&dir), &wider).unwrap();

        assert_eq!(sidebar_sizes(&settings_in(&dir)), wider);
    }

    #[test]
    fn other_settings_are_kept() {
        let dir = TempDir::new().unwrap();
        save_editor_settings(&settings_in(&dir), &EditorSettings { block_handles: false, ..Default::default() }).unwrap();

        save_sidebar_sizes(&settings_in(&dir), &SidebarSizes { width: 300.0, files_share: 0.5 }).unwrap();

        assert!(!editor_settings(&settings_in(&dir)).block_handles);
    }
}
