// Prints the syntax tree of the text given as the first argument (for working on the editor).
fn main() {
    let text = std::env::args().nth(1).unwrap_or_default();
    print(&typst_syntax::parse(&text), 0, 0);
}

fn print(node: &typst_syntax::SyntaxNode, depth: usize, from: usize) {
    let error = if node.diagnosis().errors { " !" } else { "" };
    let leaf = if node.children().len() == 0 { format!(" {:?}", node.full_text()) } else { String::new() };
    println!("{}{:?}{} {}..{}{}", "  ".repeat(depth), node.kind(), error, from, from + node.len(), leaf);
    let mut at = from;
    for child in node.children() {
        print(child, depth + 1, at);
        at += child.len();
    }
}
