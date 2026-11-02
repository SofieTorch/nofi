//! Drawing parts of a note with the real Typst compiler, as SVG pictures for the writing view:
//! maths (like `$x^2$`), and blocks like tables, figures and grids.

use crate::typst_world::{readable, NoteWorld};
use typst::syntax::SyntaxKind;
use typst_layout::PagedDocument;

/// Fits the picture tightly around the maths. 13pt (about 17px) is a bit bigger than the editor's
/// 15px text, because Typst's maths font looks smaller than the app's font at the same size.
/// The line is as tall as the maths really is ("bounds"): by default it ends at the baseline and
/// the capitals' top, so subscripts and tall superscripts would be cut off.
const PREAMBLE: &str = "#set page(width: auto, height: auto, margin: 0pt, fill: none)\n\
                        #set text(size: 13pt, top-edge: \"bounds\", bottom-edge: \"bounds\")\n";

/// Draws one piece of maths, written with its dollars (`$x^2$`, or `$ x^2 $` for a display
/// equation). Returns an SVG picture, or a readable reason it can't be drawn.
pub fn render_maths(maths: &str) -> Result<String, String> {
    if !is_one_equation(maths) {
        return Err("This isn't maths: write it between dollar signs, like $x^2$.".into());
    }
    let (svg, height) = draw_page(PREAMBLE, maths)?;
    // How far it reaches below the baseline: drawn again, cut at the baseline, the difference.
    let (_, to_baseline) = draw_page(&PREAMBLE.replace("bottom-edge: \"bounds\"", "bottom-edge: \"baseline\""), maths)?;
    let descent = (height - to_baseline).max(0.0);
    Ok(svg.replacen("<svg ", &format!("<svg data-descent=\"{descent:.2}\" "), 1))
}

/// How wide blocks are drawn: the writing view's text is about 600px wide, which is 450pt, so
/// pictures are shown at their real size, with text the size of the note's (15px is 11.25pt).
pub const BLOCK_WIDTH_PT: f64 = 450.0;

/// The functions whose blocks are drawn in the writing view.
const DRAWN_BLOCKS: [&str; 4] = ["table", "figure", "grid", "line"];

/// Draws one table, figure or grid (written as `#table(…)` etc.) as wide as the writing view and
/// as tall as it needs. Returns an SVG picture, or a readable reason it can't be drawn.
pub fn render_block(block: &str) -> Result<String, String> {
    let markup = typst::syntax::parse(block);
    let parts: Vec<_> = markup.children().filter(|n| !n.kind().is_trivia() && n.kind() != SyntaxKind::Space).collect();
    let is_drawn_block = matches!(parts.as_slice(), [hash, call]
        if hash.kind() == SyntaxKind::Hash
            && call.kind() == SyntaxKind::FuncCall
            && call.children().next().is_some_and(|callee| DRAWN_BLOCKS.contains(&callee.full_text().as_str())));
    if !is_drawn_block {
        return Err("Only a table, figure, grid or line can be drawn on its own.".into());
    }
    let preamble = format!(
        // A little room above and below, or letters hanging below the last line (like a
        // caption's "g") are cut off.
        "#set page(width: {BLOCK_WIDTH_PT}pt, height: auto, margin: (x: 0pt, y: 4pt), fill: none)\n\
         #set text(size: 11.25pt)\n"
    );
    draw(&preamble, block)
}

fn draw(preamble: &str, source: &str) -> Result<String, String> {
    draw_page(preamble, source).map(|(svg, _)| svg)
}

/// The picture, and its height in points.
fn draw_page(preamble: &str, source: &str) -> Result<(String, f64), String> {
    let world = NoteWorld::new(format!("{preamble}{source}"));
    let document = typst::compile::<PagedDocument>(&world)
        .output
        .map_err(|errors| match errors.first() {
            Some(error) => readable(&error.message),
            None => "Typst couldn't draw this.".into(),
        })?;
    let page = document.pages().first().ok_or("Typst drew nothing.")?;
    Ok((typst_svg::svg(page, &Default::default()), page.frame.height().to_pt()))
}

/// True if the text is exactly one `$…$` equation and nothing else. An equation with a mistake
/// inside still counts: Typst then explains the mistake.
fn is_one_equation(text: &str) -> bool {
    let markup = typst::syntax::parse(text);
    let parts: Vec<_> = markup.children().filter(|n| n.kind() != SyntaxKind::Space).collect();
    parts.len() == 1 && parts[0].kind() == SyntaxKind::Equation
}
