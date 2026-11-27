//! Spec: reading the user's Zotero library, for the sidebar's Library section. Zotero keeps it in a
//! database (`zotero.sqlite`) in its data folder, with the files in `storage/<key>/`. It's only
//! read, never changed; Zotero locks it while it's open, so a copy is read.
//!
//! Each paper (an item) has an id: its key in the user's own library (`ABCD2345`), or the group's
//! id and its key in a group library (`groups/12/ABCD2345`).

use marginalia_lib::zotero::*;
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// A Zotero data folder with an empty library: the tables Zotero has, as far as they're read.
struct Zotero {
    folder: TempDir,
    db: Connection,
}

impl Zotero {
    fn new() -> Self {
        let folder = TempDir::new().unwrap();
        let db = Connection::open(folder.path().join("zotero.sqlite")).unwrap();
        db.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY, type TEXT NOT NULL, editable INT NOT NULL DEFAULT 1, filesEditable INT NOT NULL DEFAULT 1);
             CREATE TABLE groups (groupID INTEGER PRIMARY KEY, libraryID INT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INT NOT NULL DEFAULT 0);
             CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
             CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT NOT NULL, dateAdded TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, libraryID INT NOT NULL, key TEXT NOT NULL);
             CREATE TABLE fieldsCombined (fieldID INT NOT NULL PRIMARY KEY, fieldName TEXT NOT NULL, label TEXT, fieldFormatID INT, custom INT NOT NULL DEFAULT 0);
             CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value UNIQUE);
             CREATE TABLE itemData (itemID INT, fieldID INT, valueID, PRIMARY KEY (itemID, fieldID));
             CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT);
             CREATE TABLE itemCreators (itemID INT NOT NULL, creatorID INT NOT NULL, creatorTypeID INT NOT NULL DEFAULT 1, orderIndex INT NOT NULL DEFAULT 0);
             CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT NOT NULL, parentCollectionID INT DEFAULT NULL, libraryID INT NOT NULL, key TEXT NOT NULL);
             CREATE TABLE collectionItems (collectionID INT NOT NULL, itemID INT NOT NULL, orderIndex INT NOT NULL DEFAULT 0);
             CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INT, linkMode INT, contentType TEXT, path TEXT);
             CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
             CREATE TABLE deletedCollections (collectionID INTEGER PRIMARY KEY);
             INSERT INTO libraries VALUES (1, 'user', 1, 1);
             INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'book'), (3, 'attachment'), (4, 'note'), (5, 'annotation');
             INSERT INTO fieldsCombined (fieldID, fieldName) VALUES (1, 'title'), (2, 'date'), (3, 'url');",
        )
        .unwrap();
        Zotero { folder, db }
    }

    fn path(&self) -> &Path {
        self.folder.path()
    }

    fn insert_item(&self, library: i64, kind: i64, key: &str) -> i64 {
        self.db.execute("INSERT INTO items (itemTypeID, libraryID, key) VALUES (?1, ?2, ?3)", params![kind, library, key]).unwrap();
        self.db.last_insert_rowid()
    }

    fn set_field(&self, item: i64, field: i64, value: &str) {
        self.db.execute("INSERT OR IGNORE INTO itemDataValues (value) VALUES (?1)", params![value]).unwrap();
        self.db
            .execute(
                "INSERT INTO itemData VALUES (?1, ?2, (SELECT valueID FROM itemDataValues WHERE value = ?3))",
                params![item, field, value],
            )
            .unwrap();
    }

    /// A paper in the user's library: a journal article with a title, its authors (last names, or
    /// "First Last") and a date as Zotero keeps them ("2017-06-12 June 12, 2017").
    fn paper(&self, key: &str, title: &str, authors: &[&str], date: &str) -> i64 {
        self.paper_in(1, key, title, authors, date)
    }

    fn paper_in(&self, library: i64, key: &str, title: &str, authors: &[&str], date: &str) -> i64 {
        let item = self.insert_item(library, 1, key);
        self.set_field(item, 1, title);
        if !date.is_empty() {
            self.set_field(item, 2, date);
        }
        for (n, author) in authors.iter().enumerate() {
            let (first, last) = author.rsplit_once(' ').unwrap_or(("", author));
            self.db
                .execute("INSERT INTO creators (firstName, lastName, fieldMode) VALUES (?1, ?2, 0)", params![first, last])
                .unwrap();
            let creator = self.db.last_insert_rowid();
            self.db
                .execute("INSERT INTO itemCreators (itemID, creatorID, orderIndex) VALUES (?1, ?2, ?3)", params![item, creator, n as i64])
                .unwrap();
        }
        item
    }

    /// A PDF stored in Zotero (`storage/<key>/<name>`), attached to an item (or on its own).
    fn stored_pdf(&self, parent: Option<i64>, key: &str, name: &str) -> i64 {
        let library: i64 = match parent {
            Some(parent) => self.db.query_row("SELECT libraryID FROM items WHERE itemID = ?1", [parent], |r| r.get(0)).unwrap(),
            None => 1,
        };
        let item = self.insert_item(library, 3, key);
        self.db
            .execute(
                "INSERT INTO itemAttachments VALUES (?1, ?2, 0, 'application/pdf', ?3)",
                params![item, parent, format!("storage:{name}")],
            )
            .unwrap();
        fs::create_dir_all(self.path().join("storage").join(key)).unwrap();
        fs::write(self.path().join("storage").join(key).join(name), format!("%PDF-1.7 {key}")).unwrap();
        item
    }

    fn collection(&self, key: &str, name: &str, parent: Option<i64>, items: &[i64]) -> i64 {
        self.db
            .execute(
                "INSERT INTO collections (collectionName, parentCollectionID, libraryID, key) VALUES (?1, ?2, 1, ?3)",
                params![name, parent, key],
            )
            .unwrap();
        let collection = self.db.last_insert_rowid();
        for item in items {
            self.db.execute("INSERT INTO collectionItems VALUES (?1, ?2, 0)", params![collection, item]).unwrap();
        }
        collection
    }

    fn group(&self, library: i64, group: i64, name: &str) {
        self.db.execute("INSERT INTO libraries VALUES (?1, 'group', 1, 1)", params![library]).unwrap();
        self.db.execute("INSERT INTO groups (groupID, libraryID, name) VALUES (?1, ?2, ?3)", params![group, library, name]).unwrap();
    }

    fn read(&self) -> ZoteroLibrary {
        read_library(self.path()).unwrap()
    }
}

fn my_library(library: &ZoteroLibrary) -> &Library {
    &library.libraries[0]
}

fn titles(library: &Library) -> Vec<&str> {
    library.items.iter().map(|item| item.title.as_str()).collect()
}

mod papers {
    use super::*;

    #[test]
    fn every_paper_is_read_with_its_title_authors_and_year() {
        let zotero = Zotero::new();
        zotero.paper("ATTN2017", "Attention Is All You Need", &["Ashish Vaswani", "Noam Shazeer"], "2017-06-12 June 12, 2017");

        let library = zotero.read();

        let paper = &my_library(&library).items[0];
        assert_eq!(paper.id, "ATTN2017");
        assert_eq!(paper.title, "Attention Is All You Need");
        assert_eq!(paper.authors, vec!["Vaswani", "Shazeer"]);
        assert_eq!(paper.year, Some(2017));
        assert_eq!(paper.kind, "journalArticle");
    }

    #[test]
    fn a_paper_without_a_date_has_no_year() {
        let zotero = Zotero::new();
        zotero.paper("NODATE01", "Undated", &[], "");

        assert_eq!(my_library(&zotero.read()).items[0].year, None);
    }

    #[test]
    fn papers_are_in_order_of_title() {
        let zotero = Zotero::new();
        zotero.paper("BBBBBBBB", "borrowing", &[], "");
        zotero.paper("AAAAAAAA", "Attention", &[], "");
        zotero.paper("CCCCCCCC", "Containers", &[], "");

        assert_eq!(titles(my_library(&zotero.read())), vec!["Attention", "borrowing", "Containers"]);
    }

    #[test]
    fn notes_attachments_and_annotations_arent_papers() {
        let zotero = Zotero::new();
        let paper = zotero.paper("ATTN2017", "Attention", &[], "");
        zotero.stored_pdf(Some(paper), "PDF00001", "attention.pdf");
        zotero.insert_item(1, 4, "NOTE0001");
        zotero.insert_item(1, 5, "ANNO0001");

        assert_eq!(titles(my_library(&zotero.read())), vec!["Attention"]);
    }

    #[test]
    fn papers_in_the_trash_are_left_out() {
        let zotero = Zotero::new();
        zotero.paper("KEEP0001", "Kept", &[], "");
        let gone = zotero.paper("GONE0001", "Deleted", &[], "");
        zotero.db.execute("INSERT INTO deletedItems VALUES (?1)", [gone]).unwrap();

        assert_eq!(titles(my_library(&zotero.read())), vec!["Kept"]);
    }

    #[test]
    fn a_paper_says_whether_it_has_a_pdf() {
        let zotero = Zotero::new();
        let with = zotero.paper("WITHPDF1", "With", &[], "");
        zotero.stored_pdf(Some(with), "PDF00001", "with.pdf");
        zotero.paper("NOPDF001", "Without", &[], "");

        let library = zotero.read();

        let has_pdf: Vec<bool> = my_library(&library).items.iter().map(|item| item.pdf).collect();
        assert_eq!(has_pdf, vec![true, false]); // With, Without
    }

    #[test]
    fn a_pdf_on_its_own_is_a_paper_too_named_by_its_title() {
        let zotero = Zotero::new();
        let pdf = zotero.stored_pdf(None, "LONEPDF1", "lonely.pdf");
        zotero.set_field(pdf, 1, "Lonely paper");

        let library = zotero.read();

        let paper = &my_library(&library).items[0];
        assert_eq!((paper.id.as_str(), paper.title.as_str(), paper.pdf), ("LONEPDF1", "Lonely paper", true));
    }
}

mod collections {
    use super::*;

    #[test]
    fn collections_list_their_papers_and_the_collections_inside_them() {
        let zotero = Zotero::new();
        let attention = zotero.paper("ATTN2017", "Attention", &[], "");
        let bert = zotero.paper("BERT2018", "BERT", &[], "");
        let thesis = zotero.collection("THESIS01", "Thesis", None, &[attention]);
        zotero.collection("LITREV01", "Literature review", Some(thesis), &[bert]);

        let library = zotero.read();

        let collections = &my_library(&library).collections;
        assert_eq!(collections.len(), 2);
        let thesis = collections.iter().find(|c| c.name == "Thesis").unwrap();
        let review = collections.iter().find(|c| c.name == "Literature review").unwrap();
        assert_eq!((thesis.key.as_str(), thesis.parent.as_deref()), ("THESIS01", None));
        assert_eq!(review.parent.as_deref(), Some("THESIS01"));
        assert_eq!(thesis.items, vec!["ATTN2017"]);
        assert_eq!(review.items, vec!["BERT2018"]);
    }

    #[test]
    fn collections_are_in_order_of_name() {
        let zotero = Zotero::new();
        zotero.collection("K0000002", "thesis", None, &[]);
        zotero.collection("K0000001", "Courses", None, &[]);

        let names: Vec<String> = my_library(&zotero.read()).collections.iter().map(|c| c.name.clone()).collect();
        assert_eq!(names, vec!["Courses", "thesis"]);
    }

    #[test]
    fn collections_in_the_trash_are_left_out() {
        let zotero = Zotero::new();
        let gone = zotero.collection("GONE0001", "Old", None, &[]);
        zotero.db.execute("INSERT INTO deletedCollections VALUES (?1)", [gone]).unwrap();

        assert!(my_library(&zotero.read()).collections.is_empty());
    }
}

mod libraries {
    use super::*;

    #[test]
    fn the_users_own_library_comes_first_then_group_libraries_by_name() {
        let zotero = Zotero::new();
        zotero.group(3, 77, "Uni projects");
        zotero.group(2, 55, "Reading group");
        zotero.paper_in(3, "UNIPAPER", "A uni paper", &[], "");

        let library = zotero.read();

        let names: Vec<&str> = library.libraries.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, vec!["My Library", "Reading group", "Uni projects"]);
        let ids: Vec<&str> = library.libraries.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, vec!["user", "groups/55", "groups/77"]);
        assert_eq!(library.libraries[2].items[0].id, "groups/77/UNIPAPER");
    }
}

mod pdfs {
    use super::*;

    #[test]
    fn a_papers_pdf_is_found_in_zoteros_storage() {
        let zotero = Zotero::new();
        let paper = zotero.paper("ATTN2017", "Attention", &[], "");
        zotero.stored_pdf(Some(paper), "PDF00001", "Vaswani - 2017 - Attention.pdf");

        assert_eq!(
            pdf_of(zotero.path(), "ATTN2017").unwrap(),
            zotero.path().join("storage/PDF00001/Vaswani - 2017 - Attention.pdf")
        );
    }

    #[test]
    fn a_pdf_on_its_own_is_its_own_pdf() {
        let zotero = Zotero::new();
        zotero.stored_pdf(None, "LONEPDF1", "lonely.pdf");

        assert_eq!(pdf_of(zotero.path(), "LONEPDF1").unwrap(), zotero.path().join("storage/LONEPDF1/lonely.pdf"));
    }

    #[test]
    fn a_group_papers_pdf_is_found_too() {
        let zotero = Zotero::new();
        zotero.group(3, 77, "Uni projects");
        let paper = zotero.paper_in(3, "UNIPAPER", "A uni paper", &[], "");
        zotero.stored_pdf(Some(paper), "PDF00003", "uni.pdf");

        assert_eq!(pdf_of(zotero.path(), "groups/77/UNIPAPER").unwrap(), zotero.path().join("storage/PDF00003/uni.pdf"));
    }

    #[test]
    fn a_paper_without_a_pdf_says_so() {
        let zotero = Zotero::new();
        zotero.paper("NOPDF001", "Without", &[], "");

        assert_eq!(pdf_of(zotero.path(), "NOPDF001").unwrap_err(), "This paper has no PDF in Zotero.");
    }

    #[test]
    fn a_pdf_zotero_hasnt_downloaded_says_so() {
        let zotero = Zotero::new();
        let paper = zotero.paper("ATTN2017", "Attention", &[], "");
        zotero.stored_pdf(Some(paper), "PDF00001", "attention.pdf");
        fs::remove_dir_all(zotero.path().join("storage/PDF00001")).unwrap();

        assert_eq!(
            pdf_of(zotero.path(), "ATTN2017").unwrap_err(),
            "The PDF isn't on this computer yet: open it once in Zotero to download it."
        );
    }

    #[test]
    fn a_paper_that_isnt_in_the_library_says_so() {
        let zotero = Zotero::new();

        assert_eq!(pdf_of(zotero.path(), "MISSING1").unwrap_err(), "This paper isn't in the Zotero library.");
    }

    #[test]
    fn its_bytes_are_read() {
        let zotero = Zotero::new();
        let paper = zotero.paper("ATTN2017", "Attention", &[], "");
        zotero.stored_pdf(Some(paper), "PDF00001", "attention.pdf");

        assert_eq!(read_pdf(zotero.path(), "ATTN2017").unwrap(), b"%PDF-1.7 PDF00001");
    }
}

mod reading_safely {
    use super::*;

    #[test]
    fn the_library_is_read_while_zotero_has_it_locked() {
        let zotero = Zotero::new();
        zotero.paper("ATTN2017", "Attention", &[], "");
        // (Zotero keeps its database locked while it's open.)
        zotero.db.execute_batch("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;").unwrap();

        assert_eq!(titles(my_library(&zotero.read())), vec!["Attention"]);
    }

    #[test]
    fn changes_zotero_hasnt_merged_into_the_database_yet_are_read_too() {
        let zotero = Zotero::new();
        zotero.db.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        zotero.paper("ATTN2017", "Attention", &[], "");

        assert!(zotero.path().join("zotero.sqlite-wal").metadata().unwrap().len() > 0);
        assert_eq!(titles(my_library(&zotero.read())), vec!["Attention"]);
    }

    #[test]
    fn the_database_isnt_changed() {
        let zotero = Zotero::new();
        zotero.paper("ATTN2017", "Attention", &[], "");
        zotero.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        let before = fs::read(zotero.path().join("zotero.sqlite")).unwrap();

        zotero.read();

        assert_eq!(fs::read(zotero.path().join("zotero.sqlite")).unwrap(), before);
    }

    #[test]
    fn a_folder_without_a_zotero_database_is_explained() {
        let folder = TempDir::new().unwrap();

        assert_eq!(read_library(folder.path()).unwrap_err(), "There's no Zotero library in this folder.");
    }
}

mod finding_zotero {
    use super::*;

    fn home_with_zotero_at(data: &str) -> (TempDir, PathBuf) {
        let home = TempDir::new().unwrap();
        let data = home.path().join(data);
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("zotero.sqlite"), "").unwrap();
        (home, data)
    }

    #[test]
    fn zotero_is_found_in_its_usual_folder() {
        let (home, data) = home_with_zotero_at("Zotero");

        assert_eq!(find_zotero(home.path()), Some(data));
    }

    #[test]
    fn a_data_folder_chosen_in_zoteros_settings_is_found() {
        let (home, data) = home_with_zotero_at("Documents/Research/ZoteroData");
        let profile = home.path().join("Library/Application Support/Zotero/Profiles/abc123.default");
        fs::create_dir_all(&profile).unwrap();
        fs::write(
            profile.join("prefs.js"),
            format!(
                "user_pref(\"extensions.zotero.useDataDir\", true);\nuser_pref(\"extensions.zotero.dataDir\", {});\n",
                serde_json::to_string(data.to_str().unwrap()).unwrap()
            ),
        )
        .unwrap();

        assert_eq!(find_zotero(home.path()), Some(data));
    }

    #[test]
    fn without_zotero_nothing_is_found() {
        let home = TempDir::new().unwrap();

        assert_eq!(find_zotero(home.path()), None);
    }
}

mod watching {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn watched(zotero: &Zotero) -> (mpsc::Receiver<()>, impl Drop) {
        let (tell, told) = mpsc::channel();
        let watcher = watch_library(zotero.path(), move || {
            let _ = tell.send(());
        });
        (told, watcher)
    }

    #[test]
    fn a_paper_added_in_zotero_is_told() {
        let zotero = Zotero::new();
        let (told, _watcher) = watched(&zotero);

        zotero.paper("NEWPAPER", "A new paper", &[], "");

        assert!(told.recv_timeout(Duration::from_secs(5)).is_ok());
        assert_eq!(titles(my_library(&zotero.read())), vec!["A new paper"]);
    }

    #[test]
    fn a_change_merged_into_the_database_is_told() {
        let zotero = Zotero::new();
        zotero.paper("NEWPAPER", "A new paper", &[], "");
        let (told, _watcher) = watched(&zotero);

        zotero.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();

        assert!(told.recv_timeout(Duration::from_secs(5)).is_ok());
    }

    #[test]
    fn nothing_is_told_while_nothing_changes() {
        let zotero = Zotero::new();
        let (told, _watcher) = watched(&zotero);

        assert!(told.recv_timeout(Duration::from_secs(2)).is_err());
    }

    #[test]
    fn once_dropped_it_stops_watching() {
        let zotero = Zotero::new();
        let (told, watcher) = watched(&zotero);

        drop(watcher);
        zotero.paper("NEWPAPER", "A new paper", &[], "");

        assert!(told.recv_timeout(Duration::from_secs(2)).is_err());
    }

    #[test]
    fn other_files_in_zoteros_folder_dont_count() {
        let zotero = Zotero::new();
        let (told, _watcher) = watched(&zotero);

        fs::write(zotero.path().join("prefs-backup.js"), "").unwrap();
        fs::create_dir_all(zotero.path().join("storage/NEWPDF01")).unwrap();

        assert!(told.recv_timeout(Duration::from_secs(2)).is_err());
    }
}
