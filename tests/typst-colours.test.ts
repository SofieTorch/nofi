// Typst colours shown in the editor: what a colour written in a note looks like on screen.

import { describe, expect, it } from "vitest";
import { cssColour } from "../src/editor/colours";

describe("Typst colours on screen", () => {
  it("rgb with a hex code is that colour", () => {
    expect(cssColour('rgb("#e03e3e")')).toBe("#e03e3e");
  });

  it("rgb with numbers is that colour", () => {
    expect(cssColour("rgb(10, 20, 30)")).toBe("rgb(10, 20, 30)");
  });

  it("luma is a shade of grey", () => {
    expect(cssColour("luma(240)")).toBe("rgb(240, 240, 240)");
  });

  it("Typst's named colours are Typst's shades, not the browser's", () => {
    expect(cssColour("red")).toBe("#ff4136");
    expect(cssColour("aqua")).toBe("#7fdbff");
    expect(cssColour("eastern")).toBe("#239dad");
  });

  it("anything else isn't shown as a colour", () => {
    expect(cssColour("gradient.linear(red, blue)")).toBeUndefined();
    expect(cssColour("myColour")).toBeUndefined();
  });
});
