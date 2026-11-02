// Where the graph puts each note: a force layout. Every two notes push each other apart, each link
// pulls its two notes together, and a light pull keeps everything around the middle. It starts
// from where notes were (so adding one doesn't reshuffle the rest), or on a spiral for new ones.

export type Place = { x: number; y: number };

/** How far apart linked notes like to be. */
const SPACING = 70;
/** How far apart notes still push each other. */
const REACH = SPACING * 3;

export function layoutGraph(ids: string[], links: [string, string][], previous?: Map<string, Place>, steps = 300): Map<string, Place> {
  const places = new Map<string, Place>();
  ids.forEach((id, i) => {
    const was = previous?.get(id);
    // A spiral, so new notes start apart and the result is the same every time.
    const angle = i * 2.399963;
    const radius = SPACING * Math.sqrt(i + 1);
    places.set(id, was ? { ...was } : { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  const pairs = links.filter(([a, b]) => places.has(a) && places.has(b) && a !== b);
  const nodes = ids.map((id) => places.get(id)!);
  // Notes placed before move less, so the graph stays recognisable.
  const settled = ids.map((id) => (previous?.has(id) ? 0.02 : 1));

  for (let step = 0; step < steps; step++) {
    const heat = 1 - step / steps;
    const moves = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        if (dx === 0 && dy === 0) [dx, dy] = [0.01 * (i - j), 0.01];
        const squared = Math.max(dx * dx + dy * dy, 1);
        // Only notes near each other push apart, so ones without links don't drift far away.
        if (squared > REACH * REACH) continue;
        const push = (SPACING * SPACING) / squared;
        moves[i].x += dx * push;
        moves[i].y += dy * push;
        moves[j].x -= dx * push;
        moves[j].y -= dy * push;
      }
    }
    for (const [a, b] of pairs) {
      const i = ids.indexOf(a);
      const j = ids.indexOf(b);
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const length = Math.hypot(dx, dy) || 1;
      const pull = (length - SPACING) / length / 2;
      moves[i].x += dx * pull;
      moves[i].y += dy * pull;
      moves[j].x -= dx * pull;
      moves[j].y -= dy * pull;
    }
    nodes.forEach((node, i) => {
      moves[i].x -= node.x * 0.05;
      moves[i].y -= node.y * 0.05;
      // Never more than a step's worth at once, less and less as it settles.
      const length = Math.hypot(moves[i].x, moves[i].y);
      const most = 12 * heat * settled[i];
      const scale = length > most ? most / length : 1;
      node.x += moves[i].x * scale;
      node.y += moves[i].y * scale;
    });
  }
  return places;
}

/** A note in the live graph: where it is, how fast it's moving, and whether it's held. */
type Body = Place & { vx: number; vy: number; held: boolean };

/**
 * The live graph, like Obsidian's: dragging a note pulls the notes linked to it along, and
 * everything settles again after (the same forces as the layout, step by step, with momentum).
 * `tick` moves everything one step and says whether anything is still moving.
 */
export class GraphSimulation {
  private bodies = new Map<string, Body>();
  /** How lively it is: 1 just after a change, less each step, 0 at rest. */
  private energy = 0;

  constructor(
    private ids: string[],
    private links: [string, string][],
    start: Map<string, Place>,
  ) {
    ids.forEach((id) => {
      const place = start.get(id) ?? { x: 0, y: 0 };
      this.bodies.set(id, { ...place, vx: 0, vy: 0, held: false });
    });
  }

  has(id: string) {
    return this.bodies.has(id);
  }

  placeOf(id: string): Place {
    const body = this.bodies.get(id)!;
    return { x: body.x, y: body.y };
  }

  /** Holds a note at a place (while it's dragged), waking the graph up. */
  hold(id: string, place: Place) {
    const body = this.bodies.get(id);
    if (!body) return;
    Object.assign(body, place, { vx: 0, vy: 0, held: true });
    this.energy = Math.max(this.energy, 0.5);
  }

  release(id: string) {
    const body = this.bodies.get(id);
    if (body) body.held = false;
    this.energy = Math.max(this.energy, 0.3);
  }

  tick(): boolean {
    const held = [...this.bodies.values()].some((body) => body.held);
    if (this.energy < 0.005 && !held) return false;
    const nodes = this.ids.map((id) => this.bodies.get(id)!);
    const force = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        if (dx === 0 && dy === 0) [dx, dy] = [0.01 * (i - j), 0.01];
        const squared = Math.max(dx * dx + dy * dy, 1);
        if (squared > REACH * REACH) continue;
        const push = (SPACING * SPACING) / squared;
        force[i].x += dx * push;
        force[i].y += dy * push;
        force[j].x -= dx * push;
        force[j].y -= dy * push;
      }
    }
    for (const [a, b] of this.links) {
      const i = this.ids.indexOf(a);
      const j = this.ids.indexOf(b);
      if (i === -1 || j === -1 || i === j) continue;
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const length = Math.hypot(dx, dy) || 1;
      const pull = ((length - SPACING) / length) * 0.3;
      force[i].x += dx * pull;
      force[i].y += dy * pull;
      force[j].x -= dx * pull;
      force[j].y -= dy * pull;
    }
    nodes.forEach((node, i) => {
      if (node.held) return;
      force[i].x -= node.x * 0.02;
      force[i].y -= node.y * 0.02;
      node.vx = (node.vx + force[i].x * this.energy * 0.2) * 0.6;
      node.vy = (node.vy + force[i].y * this.energy * 0.2) * 0.6;
      node.x += node.vx;
      node.y += node.vy;
    });
    // Held, it stays lively; let go, it calms down.
    this.energy = held ? Math.max(this.energy, 0.3) : this.energy * 0.97;
    return true;
  }
}
