// Where the graph puts each note: linked notes are pulled together, all notes push each other
// apart, and everything is kept around the middle (a force layout, like Obsidian's graph).

import { describe, expect, it } from "vitest";
import { GraphSimulation, layoutGraph } from "../src/workspace/graphLayout";

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("Laying out the graph", () => {
  it("gives every note a place", () => {
    const places = layoutGraph(["A", "B", "C"], [["A", "B"]]);

    expect([...places.keys()].sort()).toEqual(["A", "B", "C"]);
    for (const place of places.values()) expect(Number.isFinite(place.x) && Number.isFinite(place.y)).toBe(true);
  });

  it("linked notes end up closer than notes without a link between them", () => {
    const places = layoutGraph(["A", "B", "C", "D"], [["A", "B"], ["C", "D"]]);

    expect(distance(places.get("A")!, places.get("B")!)).toBeLessThan(distance(places.get("A")!, places.get("C")!));
  });

  it("notes don't sit on top of each other", () => {
    const places = layoutGraph(["A", "B", "C", "D", "E"], []);
    const all = [...places.values()];

    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(distance(all[i], all[j])).toBeGreaterThan(10);
  });

  it("is the same each time for the same notes", () => {
    expect(layoutGraph(["A", "B"], [["A", "B"]])).toEqual(layoutGraph(["A", "B"], [["A", "B"]]));
  });

  it("notes already placed start where they were, so the graph doesn't jump when a note is added", () => {
    const before = layoutGraph(["A", "B", "C"], [["A", "B"]]);

    const after = layoutGraph(["A", "B", "C", "D"], [["A", "B"]], before);

    expect(distance(before.get("A")!, after.get("A")!)).toBeLessThan(60);
  });
});

describe("Moving notes around (the live graph)", () => {
  const run = (simulation: GraphSimulation) => {
    for (let i = 0; i < 300 && simulation.tick(); i++);
  };

  it("a held note stays where it's held", () => {
    const simulation = new GraphSimulation(["A", "B"], [["A", "B"]], layoutGraph(["A", "B"], [["A", "B"]]));

    simulation.hold("A", { x: 500, y: 500 });
    run(simulation);

    expect(simulation.placeOf("A")).toEqual({ x: 500, y: 500 });
  });

  it("the notes linked to it follow it", () => {
    const start = layoutGraph(["A", "B", "C"], [["A", "B"]]);
    const simulation = new GraphSimulation(["A", "B", "C"], [["A", "B"]], start);

    simulation.hold("A", { x: 500, y: 500 });
    run(simulation);

    expect(distance(simulation.placeOf("B"), { x: 500, y: 500 })).toBeLessThan(distance(start.get("B")!, { x: 500, y: 500 }));
  });

  it("let go, it stays about where it was left, and everything comes to rest", () => {
    const simulation = new GraphSimulation(["A", "B"], [["A", "B"]], layoutGraph(["A", "B"], [["A", "B"]]));
    simulation.hold("A", { x: 300, y: 0 });
    run(simulation);

    simulation.release("A");
    run(simulation);

    expect(simulation.tick()).toBe(false);
    expect(distance(simulation.placeOf("A"), { x: 300, y: 0 })).toBeLessThan(200);
  });

  it("at rest, nothing moves", () => {
    const simulation = new GraphSimulation(["A", "B"], [["A", "B"]], layoutGraph(["A", "B"], [["A", "B"]]));

    expect(simulation.tick()).toBe(false);
  });
});
