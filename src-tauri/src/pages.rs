//! The page view: a whole Typst note drawn as pages, the way it would print or export to PDF.

use crate::typst_world::{readable, NoteWorld};
use serde::Serialize;
use typst::layout::{Abs, Frame, FrameItem, Point, Transform};
use typst::syntax::{Source, SyntaxKind};
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

/// A place in the note's text on its pages: where the text is (in UTF-16 code units, as the editor
/// counts), the page (from 0), and how far down and across it (in points from the page's top left).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Place {
    pub offset: usize,
    pub page: usize,
    pub y: f64,
    /// How far across the page (points from its left): which column, in columns.
    pub x: f64,
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

    /// Where the note's text is on its pages, for scrolling the editor and the pages together: a
    /// place for each piece of text Typst laid out, in the note's order. Text laid out elsewhere
    /// than the note's order (a header on every page, a figure floated to another page) is left
    /// out: the places kept are the longest run of them, page after page, in the note's order.
    pub fn places(&self) -> Vec<Place> {
        let source = self.world.source_text();
        let mut found = Vec::new();
        for (index, page) in self.document.pages().iter().enumerate() {
            collect_places(&page.frame, Transform::identity(), source, index, &mut found);
        }
        // Page by page, in the note's order on each (in columns, a page's text isn't top to bottom).
        found.sort_by_key(|place| (place.page, place.offset));
        in_order(found)
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

/// The places in a frame (and the frames in it), where `ts` puts the frame on its page.
fn collect_places(frame: &Frame, ts: Transform, source: &Source, page: usize, found: &mut Vec<Place>) {
    for (pos, item) in frame.items() {
        match item {
            FrameItem::Group(group) => {
                let inner = ts.pre_concat(Transform::translate(pos.x, pos.y)).pre_concat(group.transform);
                collect_places(&group.frame, inner, source, page, found);
            }
            FrameItem::Text(text) => {
                let Some(glyph) = text.glyphs.first() else { continue };
                let (span, span_offset) = glyph.span;
                if span.id() != Some(source.id()) {
                    continue;
                }
                let Some(node) = source.find(span) else { continue };
                let byte = if matches!(node.kind(), SyntaxKind::Text | SyntaxKind::MathText) {
                    node.range().start + usize::from(span_offset)
                } else {
                    node.range().start
                };
                let Some(offset) = source.lines().byte_to_utf16(byte) else { continue };
                // (The line's top: a text's position is its baseline.)
                let top = Point::new(pos.x, pos.y - text.size).transform(ts);
                found.push(Place { offset, page, y: top.y.to_pt().max(0.0), x: top.x.to_pt().max(0.0) });
            }
            _ => {}
        }
    }
}

/// The longest run of places (in the order given) whose offsets keep growing.
fn in_order(places: Vec<Place>) -> Vec<Place> {
    // Patience sorting: `ends[k]` is the place ending the best run of k + 1 so far.
    let mut ends: Vec<usize> = Vec::new();
    let mut before: Vec<Option<usize>> = vec![None; places.len()];
    for (i, place) in places.iter().enumerate() {
        let k = ends.partition_point(|&e| places[e].offset < place.offset);
        before[i] = if k > 0 { Some(ends[k - 1]) } else { None };
        if k == ends.len() {
            ends.push(i);
        } else {
            ends[k] = i;
        }
    }
    let mut run = Vec::new();
    let mut at = ends.last().copied();
    while let Some(i) = at {
        run.push(places[i].clone());
        at = before[i];
    }
    run.reverse();
    run
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
