//! Spec: what clicking a link may open outside the app. Websites (and email addresses) open in
//! the browser (or mail app); files in the workspace that the app doesn't show itself open in
//! their own app. Nothing else: no other kinds of addresses, and nothing outside the workspace.

use marginalia_lib::external::*;
use marginalia_lib::workspace::open_folder;
use std::fs;
use tempfile::TempDir;

mod websites {
    use super::*;

    #[test]
    fn web_and_email_addresses_can_be_opened() {
        for url in ["https://typst.app", "http://example.com/a?b=c", "mailto:me@example.com"] {
            assert_eq!(checked_url(url).as_deref(), Ok(url));
        }
    }

    #[test]
    fn other_kinds_of_addresses_cant() {
        for url in ["file:///etc/passwd", "javascript:alert(1)", "smb://server/share", "ssh://host", "not a url"] {
            assert!(checked_url(url).is_err(), "{url}");
        }
    }
}

mod workspace_files {
    use super::*;

    #[test]
    fn a_file_in_the_workspace_can_be_opened() {
        let workspace = TempDir::new().unwrap();
        open_folder(workspace.path()).unwrap();
        fs::write(workspace.path().join("data.csv"), "a,b").unwrap();

        assert_eq!(checked_file(workspace.path(), "data.csv").unwrap(), workspace.path().join("data.csv"));
    }

    #[test]
    fn a_missing_file_says_so() {
        let workspace = TempDir::new().unwrap();

        assert_eq!(checked_file(workspace.path(), "gone.csv").unwrap_err(), "\"gone.csv\" isn't in the workspace.");
    }

    #[test]
    fn nothing_outside_the_workspace() {
        let workspace = TempDir::new().unwrap();

        assert!(checked_file(workspace.path(), "../../etc/passwd").is_err());
    }
}
