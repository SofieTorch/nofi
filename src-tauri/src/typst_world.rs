//! What the Typst compiler can see while drawing a note or its maths.

use std::sync::OnceLock;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst_kit::fonts::FontStore;
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

/// Typst's messages start in lowercase ("unclosed delimiter"): make them a sentence.
pub fn readable(message: &str) -> String {
    let mut chars = message.chars();
    let first = chars.next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
    format!("{first}{}.", chars.as_str().trim_end_matches('.'))
}

/// Everything the compiler can see: one note's text, the standard library and the fonts (the
/// ones that come with Typst, then the computer's own).
/// No files and no packages, so a note can't reach anything else on the computer.
pub struct NoteWorld {
    source: Source,
}

struct Shared {
    library: LazyHash<Library>,
    fonts: FontStore,
}

/// Loading the fonts and the library takes a moment, so it's done once for the whole app.
/// The computer's fonts are only found here, and each one is only read when a note uses it.
fn shared() -> &'static Shared {
    static SHARED: OnceLock<Shared> = OnceLock::new();
    SHARED.get_or_init(|| {
        let mut fonts = FontStore::new();
        fonts.extend(typst_kit::fonts::embedded());
        fonts.extend(typst_kit::fonts::system());
        Shared { library: LazyHash::new(Library::default()), fonts }
    })
}

/// The names of all fonts a note can use, once each, in alphabetical order.
pub fn font_families() -> Vec<String> {
    let mut names: Vec<String> =
        shared().fonts.book().families().map(|(name, _)| name.to_string()).collect();
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
}

impl NoteWorld {
    pub fn new(text: String) -> Self {
        Self { source: Source::detached(text) }
    }
}

impl World for NoteWorld {
    fn library(&self) -> &LazyHash<Library> {
        &shared().library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        shared().fonts.book()
    }

    fn main(&self) -> FileId {
        self.source.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.source.id() {
            Ok(self.source.clone())
        } else {
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, _id: FileId) -> FileResult<Bytes> {
        Err(FileError::AccessDenied)
    }

    fn font(&self, index: usize) -> Option<Font> {
        shared().fonts.font(index)
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        None
    }
}

impl NoteWorld {
    pub fn source_text(&self) -> &Source {
        &self.source
    }
}

/// Lets Typst's editor helpers (like finding the text behind a click) use this world.
impl typst_ide::IdeWorld for NoteWorld {
    fn upcast(&self) -> &dyn World {
        self
    }
}
