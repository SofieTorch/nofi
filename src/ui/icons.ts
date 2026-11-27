// Icons not in Material Design Icons, as 24×24 SVG paths like @mdi/js's.

/**
 * A window with a sidebar on its left (an outlined rounded rectangle, a line down its left part,
 * and three short lines in that part), like macOS's "sidebar.left": for pinning the sidebar.
 */
export const sidebarLeft = [
  // The window, outlined (the inside runs the other way, so it's left empty).
  "M5 4H19A2 2 0 0 1 21 6V18A2 2 0 0 1 19 20H5A2 2 0 0 1 3 18V6A2 2 0 0 1 5 4Z",
  "M5 6V18H19V6Z",
  // The line between the sidebar and the rest.
  "M9 6H10.5V18H9Z",
  // The sidebar's three lines.
  "M6 8.25H8V9.5H6Z",
  "M6 10.75H8V12H6Z",
  "M6 13.25H8V14.5H6Z",
].join("");

/** The same, with the sidebar on the right: for the notes in a PDF's margin. */
export const sidebarRight = [
  "M5 4H19A2 2 0 0 1 21 6V18A2 2 0 0 1 19 20H5A2 2 0 0 1 3 18V6A2 2 0 0 1 5 4Z",
  "M5 6V18H19V6Z",
  "M13.5 6H15V18H13.5Z",
  "M16 8.25H18V9.5H16Z",
  "M16 10.75H18V12H16Z",
  "M16 13.25H18V14.5H16Z",
].join("");
