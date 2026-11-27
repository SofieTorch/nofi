// Scrolling a Typst note and its pages together (see page-view.test.tsx › Scrolling together): the
// backend says where pieces of the note's text are on the pages ("places", in the note's order);
// between two places, a spot in the text is that far between them on the pages. Pages are counted
// one after another, each page's top where the one before ends.
//
// In columns, a page's text isn't top to bottom: the pages go to the editor's text exactly (the next
// column's text is higher up again), and going down such a page goes through all of its text, the
// first column and then the next.

import { describe, expect, it } from "vitest";
import { downPagesAt, pageStarts, spotAt, textAt } from "../src/editor/scrollSync";

const pages = [{ height: 800 }, { height: 800 }];
const places = [
  { offset: 100, page: 0, y: 50, x: 40 },
  { offset: 300, page: 0, y: 450, x: 40 },
  { offset: 500, page: 1, y: 50, x: 40 },
];

describe("Where text is on the pages", () => {
  it("each page starts where the one before ends", () => {
    expect(pageStarts(pages)).toEqual([0, 800]);
  });

  it("a place's text is at that place", () => {
    expect(downPagesAt(places, pages, 300)).toBe(450);
    expect(downPagesAt(places, pages, 500)).toBe(850);
  });

  it("text between two places is that far between them, across pages too", () => {
    expect(downPagesAt(places, pages, 200)).toBe(250);
    expect(downPagesAt(places, pages, 400)).toBe(650);
  });

  it("before the first place, from the top; after the last, at it", () => {
    expect(downPagesAt(places, pages, 0)).toBe(0);
    expect(downPagesAt(places, pages, 50)).toBe(25);
    expect(downPagesAt(places, pages, 900)).toBe(850);
  });

  it("and back: a height on the pages is the text that's there", () => {
    expect(textAt(places, pages, 250)).toBe(200);
    expect(textAt(places, pages, 650)).toBe(400);
    expect(textAt(places, pages, 0)).toBe(0);
    expect(textAt(places, pages, 1500)).toBe(500);
  });

  it("with no places, the top", () => {
    expect(downPagesAt([], pages, 300)).toBe(0);
    expect(textAt([], pages, 300)).toBe(0);
  });
});

describe("In columns", () => {
  // Page 1 in two columns: text 100–300 down the left one, 300–500 down the right one.
  const columns = [
    { offset: 100, page: 0, y: 50, x: 40 },
    { offset: 290, page: 0, y: 700, x: 40 },
    { offset: 300, page: 0, y: 50, x: 320 },
    { offset: 490, page: 0, y: 700, x: 320 },
    { offset: 500, page: 1, y: 50, x: 40 },
  ];

  it("the editor's spot is where its text is: the next column is higher up again, and to the right", () => {
    expect(spotAt(columns, 195)).toEqual({ page: 0, y: 375, x: 40 });
    expect(spotAt(columns, 395)).toEqual({ page: 0, y: 375, x: 320 });
    expect(downPagesAt(columns, pages, 395)).toBe(375);
  });

  it("between the end of one column and the next one's start, it's at the end of the first", () => {
    expect(spotAt(columns, 295)).toEqual({ page: 0, y: 700, x: 40 });
  });

  it("going down such a page goes through all its text, the first column and then the next", () => {
    expect(textAt(columns, pages, 0)).toBe(100);
    expect(textAt(columns, pages, 400)).toBe(300);
    expect(textAt(columns, pages, 600)).toBe(400);
    // (The next page, without columns, as before.)
    expect(textAt(columns, pages, 850)).toBe(500);
  });
});
