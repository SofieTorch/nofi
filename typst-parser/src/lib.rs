//! Typst's parser for the editor, as plain WebAssembly (no JavaScript glue).
//!
//! The editor copies a note's text in (`alloc`, then `parse`) and reads back its syntax tree as
//! numbers: four per node, in document order (a node, then everything inside it):
//!
//! - its kind (`SyntaxKind` as a number; `kind_names` lists them), plus 256 if it's an error;
//! - where it starts and ends, in UTF-16 code units (how the editor counts);
//! - how many nodes it takes up, itself included (to skip what's inside it).

use std::cell::RefCell;
use typst_syntax::{SyntaxKind, SyntaxNode};

thread_local! {
    static TREE: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
    static NAMES: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Room for `len` bytes, for the editor to copy text into.
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// Gives back room made by `alloc`.
///
/// # Safety
/// `ptr` and `len` must be what `alloc` was called with and returned.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

/// Parses `len` bytes of UTF-8 Typst at `ptr`; returns where the tree is (`tree_len` numbers).
///
/// # Safety
/// `ptr` must point to `len` bytes of valid UTF-8.
#[no_mangle]
pub unsafe extern "C" fn parse(ptr: *const u8, len: usize) -> *const u32 {
    let text = std::str::from_utf8_unchecked(std::slice::from_raw_parts(ptr, len));
    TREE.with_borrow_mut(|tree| {
        *tree = tree_of(text);
        tree.as_ptr()
    })
}

/// How many numbers the last tree is.
#[no_mangle]
pub extern "C" fn tree_len() -> usize {
    TREE.with_borrow(|tree| tree.len())
}

/// The kinds' names (like `Strong`), one per line, in the order of their numbers.
#[no_mangle]
pub extern "C" fn kind_names() -> *const u8 {
    NAMES.with_borrow_mut(|names| {
        if names.is_empty() {
            *names = all_kinds().map(|kind| format!("{kind:?}")).collect::<Vec<_>>().join("\n");
        }
        names.as_ptr()
    })
}

#[no_mangle]
pub extern "C" fn kind_names_len() -> usize {
    kind_names();
    NAMES.with_borrow(|names| names.len())
}

fn all_kinds() -> impl Iterator<Item = SyntaxKind> {
    // SyntaxKind is a #[repr(u8)] enum without gaps, from End to its last kind.
    (0..=SyntaxKind::DestructAssignment as u8).map(|n| unsafe { std::mem::transmute::<u8, SyntaxKind>(n) })
}

/// A note's syntax tree, as numbers (see the top of this file).
pub fn tree_of(text: &str) -> Vec<u32> {
    // Where each byte is in UTF-16 code units.
    let mut utf16 = vec![0u32; text.len() + 1];
    let mut at = 0u32;
    for (byte, char) in text.char_indices() {
        utf16[byte] = at;
        at += char.len_utf16() as u32;
    }
    utf16[text.len()] = at;

    let root = typst_syntax::parse(text);
    let mut tree = Vec::new();
    write(&root, 0, &utf16, &mut tree);
    tree
}

fn write(node: &SyntaxNode, from: usize, utf16: &[u32], tree: &mut Vec<u32>) {
    let start = tree.len();
    let kind = node.kind() as u32 + if node.diagnosis().errors { 256 } else { 0 };
    tree.extend([kind, utf16[from], utf16[from + node.len()], 0]);
    let mut at = from;
    for child in node.children() {
        write(child, at, utf16, tree);
        at += child.len();
    }
    tree[start + 3] = ((tree.len() - start) / 4) as u32;
}
