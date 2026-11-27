//! The user's Zotero library (see tests/zotero_library.rs): its papers and collections, and the
//! papers' PDFs, for the sidebar's Library section. Only read, never changed.
//!
//! Zotero keeps the library in `zotero.sqlite` in its data folder, and the files in
//! `storage/<attachment key>/`. While Zotero is open it keeps the database locked, so a copy is
//! read (with its write-ahead log, which has the changes not merged into it yet).

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

const DATABASE: &str = "zotero.sqlite";

#[derive(Debug, Serialize)]
pub struct ZoteroLibrary {
    /// The user's own library first, then their group libraries, by name.
    pub libraries: Vec<Library>,
}

#[derive(Debug, Serialize)]
pub struct Library {
    /// `user` for the user's own library, `groups/<group id>` for a group's.
    pub id: String,
    pub name: String,
    /// In order of name.
    pub collections: Vec<Collection>,
    /// Every paper in the library, in order of title.
    pub items: Vec<Item>,
}

#[derive(Debug, Serialize)]
pub struct Collection {
    pub key: String,
    pub name: String,
    /// The collection it's in, if it's inside another.
    pub parent: Option<String>,
    /// Its papers' ids.
    pub items: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct Item {
    /// Its key, in the user's own library; `groups/<group id>/<key>` in a group's.
    pub id: String,
    pub title: String,
    /// Its authors' last names, in order.
    pub authors: Vec<String>,
    pub year: Option<i32>,
    /// Zotero's item type, like `journalArticle` or `book` (`attachment` for a PDF on its own).
    pub kind: String,
    /// Whether it has a PDF.
    pub pdf: bool,
}

/// Where Zotero keeps its data on this computer (the folder with `zotero.sqlite`), if it's there:
/// the folder chosen in Zotero's settings, or else `~/Zotero`.
pub fn find_zotero(home: &Path) -> Option<PathBuf> {
    let profiles = [
        home.join("Library/Application Support/Zotero/Profiles"),
        home.join("AppData/Roaming/Zotero/Zotero/Profiles"),
        home.join(".zotero/zotero"),
    ];
    let chosen = profiles
        .iter()
        .filter_map(|folder| fs::read_dir(folder).ok())
        .flatten()
        .flatten()
        .filter_map(|profile| fs::read_to_string(profile.path().join("prefs.js")).ok())
        .filter_map(|prefs| data_dir_pref(&prefs));
    chosen
        .chain(std::iter::once(home.join("Zotero")))
        .find(|folder| folder.join(DATABASE).is_file())
}

/// The data folder in Zotero's preferences: `user_pref("extensions.zotero.dataDir", "…");`.
fn data_dir_pref(prefs: &str) -> Option<PathBuf> {
    const PREF: &str = "user_pref(\"extensions.zotero.dataDir\",";
    let rest = &prefs[prefs.find(PREF)? + PREF.len()..];
    let value = rest[..rest.find(");")?].trim();
    serde_json::from_str::<String>(value).ok().map(PathBuf::from)
}

/// A copy of Zotero's database, opened, and removed again when done.
struct Copy {
    folder: PathBuf,
    db: Connection,
}

impl Drop for Copy {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.folder);
    }
}

fn open_copy(data: &Path) -> Result<Copy, String> {
    static COPIES: AtomicUsize = AtomicUsize::new(0);
    let database = data.join(DATABASE);
    if !database.is_file() {
        return Err("There's no Zotero library in this folder.".into());
    }
    let folder = std::env::temp_dir().join(format!(
        "marginalia-zotero-{}-{}",
        std::process::id(),
        COPIES.fetch_add(1, Ordering::Relaxed)
    ));
    let couldnt = |e: &dyn std::fmt::Display| format!("Couldn't read the Zotero library: {e}");
    fs::create_dir_all(&folder).map_err(|e| couldnt(&e))?;
    let copy = |name: &str| -> std::io::Result<()> {
        match fs::copy(data.join(name), folder.join(name)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && name != DATABASE => Ok(()),
            other => other.map(|_| ()),
        }
    };
    let copied = copy(DATABASE).and_then(|_| copy(&format!("{DATABASE}-wal")));
    if let Err(e) = copied {
        let _ = fs::remove_dir_all(&folder);
        return Err(couldnt(&e));
    }
    match Connection::open(folder.join(DATABASE)) {
        Ok(db) => Ok(Copy { folder, db }),
        Err(e) => {
            let _ = fs::remove_dir_all(&folder);
            Err(couldnt(&e))
        }
    }
}

/// The libraries: (library id, name, group id), the user's own first, then groups by name.
fn libraries(db: &Connection) -> rusqlite::Result<Vec<(i64, String, Option<i64>)>> {
    let mut statement = db.prepare(
        "SELECT l.libraryID, g.name, g.groupID FROM libraries l LEFT JOIN groups g USING (libraryID)
         WHERE l.type = 'user' OR (l.type = 'group' AND g.groupID IS NOT NULL)
         ORDER BY l.type != 'user', lower(g.name)",
    )?;
    let rows = statement.query_map([], |row| {
        let group: Option<i64> = row.get(2)?;
        let name: Option<String> = row.get(1)?;
        Ok((row.get(0)?, name.unwrap_or_else(|| "My Library".into()), group))
    })?;
    rows.collect()
}

fn item_id(group: Option<i64>, key: &str) -> String {
    match group {
        Some(group) => format!("groups/{group}/{key}"),
        None => key.to_string(),
    }
}

/// The first year in a Zotero date ("2017-06-12 June 12, 2017", or "2017-00-00 2017").
fn year_of(date: &str) -> Option<i32> {
    let year: String = date.chars().take(4).collect();
    (year.len() == 4 && year.chars().all(|c| c.is_ascii_digit())).then(|| year.parse().ok()).flatten().filter(|y| *y > 0)
}

/// Reads the library in a Zotero data folder.
pub fn read_library(data: &Path) -> Result<ZoteroLibrary, String> {
    let copy = open_copy(data)?;
    read(&copy.db).map_err(|e| format!("Couldn't read the Zotero library: {e}"))
}

fn read(db: &Connection) -> rusqlite::Result<ZoteroLibrary> {
    // Every item's fields, and authors.
    let mut fields: HashMap<i64, HashMap<String, String>> = HashMap::new();
    let mut statement = db.prepare(
        "SELECT d.itemID, f.fieldName, v.value FROM itemData d
         JOIN fieldsCombined f USING (fieldID) JOIN itemDataValues v USING (valueID)
         WHERE f.fieldName IN ('title', 'date')",
    )?;
    for row in statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, rusqlite::types::Value>(2)?)))? {
        let (item, field, value) = row?;
        let value = match value {
            rusqlite::types::Value::Text(text) => text,
            rusqlite::types::Value::Integer(n) => n.to_string(),
            rusqlite::types::Value::Real(n) => n.to_string(),
            _ => continue,
        };
        fields.entry(item).or_default().insert(field, value);
    }
    let mut authors: HashMap<i64, Vec<String>> = HashMap::new();
    let mut statement = db.prepare(
        "SELECT ic.itemID, c.lastName FROM itemCreators ic JOIN creators c USING (creatorID) ORDER BY ic.itemID, ic.orderIndex",
    )?;
    for row in statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)))? {
        let (item, name) = row?;
        if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
            authors.entry(item).or_default().push(name.trim().to_string());
        }
    }
    let with_pdf: std::collections::HashSet<i64> = db
        .prepare(
            "SELECT parentItemID FROM itemAttachments WHERE parentItemID IS NOT NULL AND contentType = 'application/pdf'
             AND itemID NOT IN (SELECT itemID FROM deletedItems)",
        )?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    let mut result = Vec::new();
    for (library, name, group) in libraries(db)? {
        let mut items = Vec::new();
        let mut ids: HashMap<i64, String> = HashMap::new();
        let mut statement = db.prepare(
            "SELECT i.itemID, i.key, t.typeName FROM items i JOIN itemTypes t USING (itemTypeID)
             WHERE i.libraryID = ?1 AND i.itemID NOT IN (SELECT itemID FROM deletedItems)
             AND t.typeName NOT IN ('note', 'annotation')
             AND (t.typeName != 'attachment' OR i.itemID IN
                  (SELECT itemID FROM itemAttachments WHERE parentItemID IS NULL AND contentType = 'application/pdf'))",
        )?;
        for row in statement.query_map([library], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))? {
            let (item, key, kind) = row?;
            let field = |name: &str| fields.get(&item).and_then(|f| f.get(name)).cloned();
            let id = item_id(group, &key);
            ids.insert(item, id.clone());
            items.push(Item {
                id,
                title: field("title").filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Untitled".into()),
                authors: authors.remove(&item).unwrap_or_default(),
                year: field("date").as_deref().and_then(year_of),
                pdf: kind == "attachment" || with_pdf.contains(&item),
                kind,
            });
        }
        items.sort_by_key(|item| item.title.to_lowercase());

        let mut statement = db.prepare(
            "SELECT c.collectionID, c.key, c.collectionName, p.key FROM collections c
             LEFT JOIN collections p ON p.collectionID = c.parentCollectionID
             WHERE c.libraryID = ?1 AND c.collectionID NOT IN (SELECT collectionID FROM deletedCollections)
             ORDER BY lower(c.collectionName)",
        )?;
        let found: Vec<(i64, String, String, Option<String>)> = statement
            .query_map([library], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut in_collection = db.prepare("SELECT itemID FROM collectionItems WHERE collectionID = ?1 ORDER BY orderIndex")?;
        let mut collections = Vec::new();
        for (id, key, name, parent) in found {
            let members: Vec<i64> = in_collection.query_map([id], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?;
            collections.push(Collection {
                key,
                name,
                parent,
                items: members.iter().filter_map(|item| ids.get(item).cloned()).collect(),
            });
        }
        let id = group.map_or_else(|| "user".to_string(), |group| format!("groups/{group}"));
        result.push(Library { id, name, collections, items });
    }
    Ok(ZoteroLibrary { libraries: result })
}

/// Where a paper's PDF is (its id as in `Item`): the PDF itself, for one on its own, or else the
/// first PDF attached to it.
pub fn pdf_of(data: &Path, id: &str) -> Result<PathBuf, String> {
    let copy = open_copy(data)?;
    let db = &copy.db;
    let failed = |e: rusqlite::Error| format!("Couldn't read the Zotero library: {e}");
    let missing = || "This paper isn't in the Zotero library.".to_string();

    let (library, key) = match id.strip_prefix("groups/").and_then(|rest| rest.split_once('/')) {
        Some((group, key)) => {
            let library: Option<i64> = db
                .query_row("SELECT libraryID FROM groups WHERE groupID = ?1", [group], |row| row.get(0))
                .optional()
                .map_err(failed)?;
            (library.ok_or_else(missing)?, key)
        }
        None => {
            let library: Option<i64> = db
                .query_row("SELECT libraryID FROM libraries WHERE type = 'user'", [], |row| row.get(0))
                .optional()
                .map_err(failed)?;
            (library.ok_or_else(missing)?, id)
        }
    };
    let item: i64 = db
        .query_row(
            "SELECT itemID FROM items WHERE libraryID = ?1 AND key = ?2 AND itemID NOT IN (SELECT itemID FROM deletedItems)",
            rusqlite::params![library, key],
            |row| row.get(0),
        )
        .optional()
        .map_err(failed)?
        .ok_or_else(missing)?;
    let attachment: Option<(String, i64, Option<String>)> = db
        .query_row(
            "SELECT i.key, a.linkMode, a.path FROM itemAttachments a JOIN items i USING (itemID)
             WHERE (a.itemID = ?1 OR a.parentItemID = ?1) AND a.contentType = 'application/pdf'
             AND a.itemID NOT IN (SELECT itemID FROM deletedItems)
             ORDER BY a.itemID != ?1, i.dateAdded, i.itemID LIMIT 1",
            [item],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(failed)?;
    let (key, link_mode, path) = attachment.ok_or("This paper has no PDF in Zotero.")?;
    let path = path.unwrap_or_default();
    let file = match path.strip_prefix("storage:") {
        Some(name) => data.join("storage").join(&key).join(name),
        // (A linked file, somewhere else on the computer.)
        None if link_mode == 2 && Path::new(&path).is_absolute() => PathBuf::from(&path),
        None => return Err("This PDF is linked from a folder Marginalia can't find yet.".into()),
    };
    if file.is_file() {
        Ok(file)
    } else {
        Err("The PDF isn't on this computer yet: open it once in Zotero to download it.".into())
    }
}

/// A paper's PDF (its id as in `Item`).
pub fn read_pdf(data: &Path, id: &str) -> Result<Vec<u8>, String> {
    let file = pdf_of(data, id)?;
    fs::read(&file).map_err(|e| format!("Couldn't read the PDF: {e}"))
}

/// Watches Zotero's database for changes (made in Zotero, or synced into it), whether Zotero is
/// open or not: `on_change` is told once for each change, within about half a second. Stops when
/// the watcher is dropped.
///
/// (It looks at the files' size and time rather than waiting to be told by the system: while
/// Zotero is open it keeps them open, and a Mac doesn't tell about writes to a file kept open.)
pub fn watch_library(data: &Path, on_change: impl Fn() + Send + 'static) -> LibraryWatcher {
    let files = [data.join(DATABASE), data.join(format!("{DATABASE}-wal"))];
    let state = move || -> Vec<Option<(u64, std::time::SystemTime)>> {
        files.iter().map(|file| fs::metadata(file).ok().and_then(|m| Some((m.len(), m.modified().ok()?)))).collect()
    };
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopped = stop.clone();
    std::thread::spawn(move || {
        let mut last = state();
        while !stopped.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let now = state();
            if now != last && !stopped.load(Ordering::Relaxed) {
                last = now;
                on_change();
            }
        }
    });
    LibraryWatcher { stop }
}

/// Watching the Zotero library, until dropped.
pub struct LibraryWatcher {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl Drop for LibraryWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
