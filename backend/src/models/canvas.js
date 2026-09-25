// What counts as a drawing.
//
// Stroke data arrives from a phone as JSON and goes straight into jsonb, so
// this is the only place that decides what a stroke is. Two things matter and
// neither is about correctness of the art:
//
//   SIZE. A stroke is a list of points sampled from a finger, and a finger
//   moving slowly across a large canvas produces thousands of them. Left
//   unbounded, one enthusiastic drawing is a multi-megabyte row that has to
//   be parsed on every gallery read. The caps below are generous for anything
//   a person actually draws and stop a single row eating the table.
//
//   SHAPE. The renderer indexes into `points[i].x`. A malformed stroke does
//   not throw on the server — it throws on the OTHER PERSON'S PHONE, on a
//   screen they opened expecting a drawing. So it is rejected here, where
//   there is somebody to tell.
export const LIMITS = {
  strokes: 4000,
  pointsPerStroke: 6000,
  totalPoints: 120000,
  titleLength: 80,
};

const TOOLS = new Set(['pen', 'marker', 'highlighter', 'eraser', 'spray', 'neon']);
const HEX = /^#[0-9a-fA-F]{6}$/;

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * @returns {{ ok: true, value: {strokes, canvasColor} } | { ok: false, error: string }}
 */
export function normalizeDrawing(strokeData, canvasColor) {
  // The wire shape has been both `{ strokes: [...] }` and a bare array over
  // the life of this app; accept either rather than making the client care.
  const raw = Array.isArray(strokeData) ? strokeData : strokeData?.strokes;
  if (!Array.isArray(raw)) return { ok: false, error: 'strokeData must be an array of strokes' };
  if (raw.length === 0) return { ok: false, error: 'A drawing needs at least one stroke' };
  if (raw.length > LIMITS.strokes) return { ok: false, error: `A drawing may have at most ${LIMITS.strokes} strokes` };

  let total = 0;
  const strokes = [];
  for (const stroke of raw) {
    const points = stroke?.points;
    if (!Array.isArray(points) || points.length === 0) {
      return { ok: false, error: 'Every stroke needs a non-empty points array' };
    }
    if (points.length > LIMITS.pointsPerStroke) {
      return { ok: false, error: `A stroke may have at most ${LIMITS.pointsPerStroke} points` };
    }
    total += points.length;
    if (total > LIMITS.totalPoints) {
      return { ok: false, error: `A drawing may have at most ${LIMITS.totalPoints} points in total` };
    }
    // Rounded to one decimal. Finger coordinates arrive with fifteen
    // significant figures of noise, which is pure storage — a tenth of a
    // point is far below what any screen can show.
    const clean = [];
    for (const p of points) {
      if (!finite(p?.x) || !finite(p?.y)) return { ok: false, error: 'Stroke points must be finite numbers' };
      clean.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
    }
    strokes.push({
      points: clean,
      color: HEX.test(stroke.color) ? stroke.color : '#000000',
      width: finite(stroke.width) ? Math.min(80, Math.max(1, stroke.width)) : 6,
      tool: TOOLS.has(stroke.tool) ? stroke.tool : 'pen',
    });
  }

  return {
    ok: true,
    value: { strokes, canvasColor: HEX.test(canvasColor) ? canvasColor : '#FFFDF8' },
  };
}

export function normalizeTitle(title) {
  if (typeof title !== 'string') return null;
  const t = title.trim().slice(0, LIMITS.titleLength);
  return t.length ? t : null;
}
