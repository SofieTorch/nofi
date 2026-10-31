// Pictures drawn by the Typst compiler for the writing view (maths, tables…), kept so the same
// source is only drawn once (also when it's written several times, or after every keystroke
// elsewhere in the note).

import * as api from "../api";

export type MathsPicture = { svg: string } | { error: string };

type Cache = {
  drawn: Map<string, MathsPicture>;
  drawing: Map<string, Promise<MathsPicture>>;
  render: (source: string) => Promise<string>;
};

const caches: Cache[] = [];

function pictures(render: (source: string) => Promise<string>) {
  const cache: Cache = { drawn: new Map(), drawing: new Map(), render };
  caches.push(cache);
  return {
    /** The picture if it's already drawn, so it can be shown without waiting. */
    drawn: (source: string) => cache.drawn.get(source),
    draw: (source: string) => {
      let picture = cache.drawing.get(source);
      if (!picture) {
        picture = cache.render(source).then(
          (svg) => ({ svg }),
          (reason) => ({ error: String(reason) }),
        );
        picture.then((result) => cache.drawn.set(source, result));
        cache.drawing.set(source, picture);
      }
      return picture;
    },
  };
}

const maths = pictures((source) => api.renderMaths(source));
/** Tables, figures and grids. */
export const blockPictures = pictures((source) => api.renderBlock(source));

export const drawnPicture = maths.drawn;
export const drawPicture = maths.draw;

/** Forgets every picture (for tests, which each use their own fake compiler). */
export function forgetMathsPictures() {
  for (const cache of caches) {
    cache.drawn.clear();
    cache.drawing.clear();
  }
}
