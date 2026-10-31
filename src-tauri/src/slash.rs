//! The "/" menu: blocks to insert while writing, like Notion's and Obsidian's, but with what
//! Typst can do (maths, tables, figures, columns, page breaks…). Each Typst command is checked by
//! the tests to leave a note valid, so inserting one never breaks the pages.

use crate::completions::expand_snippet;
use crate::notes::NoteFormat;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SlashCommand {
    pub id: String,
    pub label: String,
    /// The group it's listed under ("Text", "Lists", "Maths", "Layout", "Insert").
    pub section: String,
    /// Other words it can be found by (typing "/eq" finds the equations).
    pub keywords: Vec<String>,
    pub description: String,
    /// What to insert, where the cursor goes, and how much is selected there to type over.
    pub insert: String,
    pub cursor: usize,
    pub selection: usize,
    /// Blocks (headings, tables…) start on their own line.
    pub block: bool,
}

/// (id, label, section, keywords, description, snippet with ${placeholders}, block)
type Entry = (&'static str, &'static str, &'static str, &'static str, &'static str, &'static str, bool);

const TYPST: &[Entry] = &[
    ("heading-1", "Heading 1", "Text", "title h1", "A big section heading.", "= ${Heading}", true),
    ("heading-2", "Heading 2", "Text", "subtitle h2", "A medium section heading.", "== ${Heading}", true),
    ("heading-3", "Heading 3", "Text", "h3", "A small section heading.", "=== ${Heading}", true),
    ("bold", "Bold", "Text", "strong", "Bold text.", "*${bold text}*", false),
    ("italic", "Italic", "Text", "emphasis", "Italic text.", "_${italic text}_", false),
    ("highlight", "Highlight", "Text", "marker", "Text with a highlighter behind it.", "#highlight[${highlighted text}]", false),
    ("strikethrough", "Strikethrough", "Text", "strike", "Crossed-out text.", "#strike[${crossed-out text}]", false),
    ("small-caps", "Small capitals", "Text", "smallcaps", "Text in small capitals.", "#smallcaps[${Text}]", false),
    ("footnote", "Footnote", "Text", "note", "A numbered note at the bottom of the page.", "#footnote[${Footnote text}]", false),
    ("link", "Link", "Text", "url web", "A link to a web page.", "#link(\"https://${example.com}\")[link text]", false),
    ("quote", "Quote", "Text", "blockquote citation", "A quotation set apart from the text.", "#quote(block: true)[${Quote}]", true),
    ("comment", "Comment", "Text", "note hidden", "A note to yourself that doesn't appear on the pages.", "// ${comment}", false),
    ("bulleted-list", "Bulleted list", "Lists", "bullet unordered", "A list with bullet points.", "- ${Item}", true),
    ("numbered-list", "Numbered list", "Lists", "ordered enumerate", "A numbered list.", "+ ${Item}", true),
    ("term-list", "Term list", "Lists", "definition glossary", "Terms with their descriptions.", "/ ${Term}: Description", true),
    ("to-do", "To-do list", "Lists", "task checkbox check checklist", "A list of tasks to tick off.", "- [ ] ${Task}", true),
    ("inline-maths", "Inline equation", "Maths", "math formula equation", "Maths within a line of text.", "$${x}$", false),
    ("display-maths", "Display equation", "Maths", "math formula equation block", "Maths on its own line, centred.", "$ ${x} $", true),
    ("matrix", "Matrix", "Maths", "math mat", "A matrix, on its own line.", "$ mat(${1}, 2; 3, 4) $", true),
    ("cases", "Cases", "Maths", "math piecewise", "A value defined case by case.", "$ f(x) = cases(${1} \"if\" x > 0, 0 \"otherwise\") $", true),
    ("columns", "Columns", "Layout", "two column split", "Text in two columns, side by side.", "#columns(2)[\n${First column}\n#colbreak()\nSecond column\n]", true),
    ("column-break", "Column break", "Layout", "colbreak", "Continues in the next column.", "#colbreak()", true),
    ("page-break", "Page break", "Layout", "new page pagebreak", "Continues on the next page.", "#pagebreak()", true),
    ("callout", "Callout", "Layout", "box block note aside", "Text in a shaded box.", "#block(fill: luma(240), inset: 10pt, radius: 4pt, width: 100%)[${Note}]", true),
    ("centered", "Centred", "Layout", "center align middle", "Centred text.", "#align(center)[${Centred text}]", true),
    ("grid", "Grid", "Layout", "side by side cells", "Content side by side in a grid.", "#grid(columns: 2, gutter: 1em, [${Left}], [Right])", true),
    ("divider", "Divider", "Layout", "line rule separator hr", "A line across the page.", "#line(length: 100%)", true),
    ("table", "Table", "Insert", "rows columns grid data", "A table with a header row.", "#table(\n  columns: 3,\n  table.header[*${Name}*][*Year*][*Venue*],\n  [Transformer], [2017], [NeurIPS],\n)", true),
    ("figure", "Figure", "Insert", "caption numbered table", "A numbered table with a caption.", "#figure(\n  table(columns: 2, [${A}], [B]),\n  caption: [Caption],\n)", true),
    ("code-block", "Code block", "Insert", "raw program snippet", "Code shown as written.", "```\n${code}\n```", true),
    ("inline-code", "Inline code", "Insert", "raw monospace", "Code within a line of text.", "`${code}`", false),
    ("outline", "Table of contents", "Insert", "outline toc contents", "A list of the note's headings.", "#outline()", true),
];

const MARKDOWN: &[Entry] = &[
    ("heading-1", "Heading 1", "Text", "title h1", "A big section heading.", "# ${Heading}", true),
    ("heading-2", "Heading 2", "Text", "subtitle h2", "A medium section heading.", "## ${Heading}", true),
    ("heading-3", "Heading 3", "Text", "h3", "A small section heading.", "### ${Heading}", true),
    ("bold", "Bold", "Text", "strong", "Bold text.", "**${bold text}**", false),
    ("italic", "Italic", "Text", "emphasis", "Italic text.", "*${italic text}*", false),
    ("link", "Link", "Text", "url web", "A link to a web page.", "[${link text}](https://example.com)", false),
    ("quote", "Quote", "Text", "blockquote citation", "A quotation set apart from the text.", "> ${Quote}", true),
    ("bulleted-list", "Bulleted list", "Lists", "bullet unordered", "A list with bullet points.", "- ${Item}", true),
    ("numbered-list", "Numbered list", "Lists", "ordered enumerate", "A numbered list.", "1. ${Item}", true),
    ("to-do", "To-do list", "Lists", "task checkbox check", "A list of tasks to tick off.", "- [ ] ${Task}", true),
    ("table", "Table", "Insert", "rows columns grid data", "A table with a header row.", "| ${Name} | Year |\n| --- | --- |\n| Transformer | 2017 |", true),
    ("code-block", "Code block", "Insert", "raw program snippet", "Code shown as written.", "```\n${code}\n```", true),
    ("inline-code", "Inline code", "Insert", "raw monospace", "Code within a line of text.", "`${code}`", false),
    ("divider", "Divider", "Insert", "line rule separator hr", "A line across the page.", "\n---\n", true),
];

/// The "/" menu's commands for a format, in the order they're listed.
pub fn slash_commands(format: NoteFormat) -> Vec<SlashCommand> {
    let entries = match format {
        NoteFormat::Typst => TYPST,
        NoteFormat::Markdown => MARKDOWN,
    };
    entries
        .iter()
        .map(|&(id, label, section, keywords, description, snippet, block)| {
            let (insert, cursor, selection) = expand_snippet(snippet);
            SlashCommand {
                id: id.into(),
                label: label.into(),
                section: section.into(),
                keywords: keywords.split(' ').map(String::from).collect(),
                description: description.into(),
                insert,
                cursor,
                selection,
                block,
            }
        })
        .collect()
}
