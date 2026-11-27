//! The page view: a whole Typst note drawn as pages, the way it would print or export to PDF.

use crate::typst_world::{readable, NoteWorld};
use serde::Serialize;
use typst::layout::{Abs, Point};
use typst::WorldExt;
use typst_ide::{jump_from_click_in_frame, Jump};
use typst_layout::PagedDocument;

/// One page, as an SVG picture plus its size in points.
#[derive(Debug, Serialize)]
pub struct PagePicture {
    pub svg: String,
    pub width: f64,
    pub height: f64,
}

/// A note drawn as pages. Kept around so clicks on the pages can be traced back to the text.
pub struct Pages {
    world: NoteWorld,
    document: PagedDocument,
}

/// Draws a note as pages, or explains its first mistake (with the line it's on).
pub fn render_pages(note: &str) -> Result<Pages, String> {
    draw(NoteWorld::new(note.to_string()))
}

/// Like `render_pages`, for a note in a workspace (path relative to its folder): it can use the
/// workspace's files, like images.
pub fn render_pages_at(note: &str, workspace: &std::path::Path, path: &str) -> Result<Pages, String> {
    draw(NoteWorld::at(note.to_string(), workspace, path))
}

fn draw(world: NoteWorld) -> Result<Pages, String> {
    let document = typst::compile::<PagedDocument>(&world).output.map_err(|errors| {
        let Some(error) = errors.first() else {
            return "Typst couldn't draw this note.".to_string();
        };
        let line = world
            .range(error.span)
            .and_then(|range| world.source_text().lines().byte_to_line(range.start));
        match line {
            Some(line) => format!("Line {}: {}", line + 1, readable(&error.message)),
            None => readable(&error.message),
        }
    })?;
    Ok(Pages { world, document })
}

impl std::fmt::Debug for Pages {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Pages({})", self.document.pages().len())
    }
}

impl Pages {
    pub fn pictures(&self) -> Vec<PagePicture> {
        self.document
            .pages()
            .iter()
            .map(|page| PagePicture {
                svg: escape_bare_ampersands(&typst_svg::svg(page, &Default::default())),
                width: page.frame.width().to_pt(),
                height: page.frame.height().to_pt(),
            })
            .collect()
    }

    /// The pages as a PDF file's bytes, the way Typst exports them.
    pub fn pdf(&self) -> Result<Vec<u8>, String> {
        typst_pdf::pdf(&self.document, &typst_pdf::PdfOptions::default()).map_err(|errors| match errors.first() {
            Some(error) => format!("Couldn't make the PDF: {}", readable(&error.message)),
            None => "Couldn't make the PDF.".to_string(),
        })
    }

    /// Saves the pages as a PDF file (replacing one that's there).
    pub fn save_pdf(&self, destination: &std::path::Path) -> Result<(), String> {
        std::fs::write(destination, self.pdf()?).map_err(|e| format!("Couldn't save the PDF: {e}"))
    }

    /// Where in the note's text a click on a page lands (`x` and `y` in points from the page's
    /// top left). Counted in UTF-16 code units, like the editor counts characters.
    pub fn position_at(&self, page: usize, x: f64, y: f64) -> Option<usize> {
        let page = self.document.pages().get(page)?;
        let click = Point::new(Abs::pt(x), Abs::pt(y));
        match jump_from_click_in_frame(&self.world, &self.document, &page.frame, click)? {
            Jump::File(id, byte) if id == self.world.source_text().id() => {
                self.world.source_text().lines().byte_to_utf16(byte)
            }
            _ => None,
        }
    }
}

/// Typst writes links' addresses into the SVG as they are, so a link to `x.pdf#page=3&quote=…`
/// leaves a bare `&` in it, and then the SVG can't be read (the page shows blank). Each one that
/// doesn't start an entity is written as `&amp;`.
fn escape_bare_ampersands(svg: &str) -> String {
    let entity = |rest: &str| {
        ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"].iter().any(|e| rest.starts_with(e))
            || rest.strip_prefix("&#").is_some_and(|code| {
                let code = code.strip_prefix('x').map_or(code, |hex| hex);
                code.find(';').is_some_and(|end| end > 0 && code[..end].chars().all(|c| c.is_ascii_hexdigit()))
            })
    };
    let mut escaped = String::with_capacity(svg.len());
    for (at, piece) in svg.split_inclusive('&').scan(0, |at, piece| {
        let start = *at;
        *at += piece.len();
        Some((start, piece))
    }) {
        escaped.push_str(piece);
        if piece.ends_with('&') && !entity(&svg[at + piece.len() - 1..]) {
            escaped.push_str("amp;");
        }
    }
    escaped
}
