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
    let world = NoteWorld::new(note.to_string());
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
                svg: typst_svg::svg(page, &Default::default()),
                width: page.frame.width().to_pt(),
                height: page.frame.height().to_pt(),
            })
            .collect()
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
