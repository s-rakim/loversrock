// What the home-screen widgets look like behind their content: the grey
// glass, one colour, a gradient, or a pattern, in colours you choose.
//
// This file is the definition. Three renderers follow it and have to agree:
//
//   components/WidgetBackdrop.js          the live preview in the app (SVG)
//   widgets/android/WidgetPainter.kt      the Android widgets (Canvas)
//   widgets/ios/GlanceWidgets.swift       the iOS widgets (SwiftUI)
//
// The geometry is written down here once, in words and in `geometry()`, so a
// change to one of them is a change to this first.
//
// A look, as stored and as sent to the native side:
//
//   { v: 1,
//     kind: 'glass' | 'solid' | 'gradient' | 'pattern',
//     gradient: 'linear' | 'radial' | 'aurora' | 'blend',   // kind 'gradient'
//     pattern: 'stripes' | 'dots' | 'checks' | 'waves',     // kind 'pattern'
//     colors: ['#RRGGBB', ...],   1 to 4
//     angle: 0..355,              degrees; 0 runs left to right
//     scale: 1..10,               pattern size
//     inkMode: 'auto' | 'dark' | 'light',  what the person chose for text
//     ink: 'dark' | 'light' }     the text colour, resolved (see inkFor)
//
// How each is drawn, on a widget w x h, centre (cx, cy):
//
//   solid     colors[0] everywhere.
//   linear    a gradient along `angle` through the centre, the colours evenly
//             spaced, reaching exactly the far corners: it runs from
//             centre - d*L to centre + d*L, where d = (cos a, sin a) and
//             L = |w/2 cos a| + |h/2 sin a|.
//   radial    from the centre outwards, radius hypot(w, h) / 2.
//   aurora    linear, plus a soft white band across it at 45% of the way
//             along (white at 0.5 alpha, fading to nothing 12% either side).
//   blend     four corners, top-left, top-right, bottom-left, bottom-right
//             (colours repeat to fill four), mixed smoothly between them.
//   patterns  drawn in a frame turned by `angle` about the centre, with cells
//             of size s = min(w, h) * (0.02 + 0.04 * scale), cell (i, j)
//             covering [i*s, (i+1)*s] x [j*s, (j+1)*s] from the centre:
//     stripes  column i in colors[i mod n].
//     checks   cell (i, j) in colors[(i + j) mod n] (n = 1: colour and tint).
//     dots     colors[0] behind; a dot of radius 0.32s at each cell centre in
//              colors[1 + (i + j) mod (n - 1)] (n = 1: the tint).
//     waves    bands k = ..., -1, 0, 1, ... under the curves
//              y = k*s + 0.35s * sin(2*pi*x / 3s), band k in colors[k mod n].
//
// The tint of a colour is that colour mixed 35% of the way to white; it is
// what a one-colour pattern draws its second colour with.
//
// Opacity (the translucency slider) applies to all of the above. The sheen
// across the top and the bright rim are drawn over every look: they are what
// makes it read as glass rather than a flat card.
import { isHexColor, luminanceOf } from '../theme';

export const KINDS = ['glass', 'solid', 'gradient', 'pattern'];
export const GRADIENTS = ['linear', 'radial', 'aurora', 'blend'];
export const PATTERNS = ['stripes', 'dots', 'checks', 'waves'];
export const MAX_COLORS = 4;

export const DEFAULT_LOOK = {
  v: 1, kind: 'glass', gradient: 'linear', pattern: 'stripes',
  colors: ['#E4E6EA'], angle: 0, scale: 4, ink: 'dark',
};

/** Ready-made looks to start from; every one of them is still editable. */
export const PRESETS = [
  { name: 'Grey glass', look: { kind: 'glass' } },
  { name: 'Aurora', look: { kind: 'gradient', gradient: 'aurora', colors: ['#0033FF', '#00FFFF', '#00FF44'], angle: 0 } },
  { name: 'Sunset', look: { kind: 'gradient', gradient: 'linear', colors: ['#FF5E62', '#FF9966', '#FFD86F'], angle: 135 } },
  { name: 'Blush', look: { kind: 'gradient', gradient: 'radial', colors: ['#FFE3EC', '#FF8FB1'] } },
  { name: 'Lagoon', look: { kind: 'gradient', gradient: 'blend', colors: ['#00C6FF', '#7F00FF', '#00F5A0', '#0072FF'] } },
  { name: 'Candy', look: { kind: 'pattern', pattern: 'stripes', colors: ['#FFB3C7', '#FFFFFF'], angle: 45, scale: 3 } },
  { name: 'Polka', look: { kind: 'pattern', pattern: 'dots', colors: ['#2B2320', '#FF5C8D', '#FFD86F'], scale: 3 } },
  { name: 'Picnic', look: { kind: 'pattern', pattern: 'checks', colors: ['#E8607A', '#FFFFFF'], angle: 0, scale: 3 } },
  { name: 'Tide', look: { kind: 'pattern', pattern: 'waves', colors: ['#0B3D91', '#1E88E5', '#81D4FA'], angle: 0, scale: 5 } },
  { name: 'Midnight', look: { kind: 'solid', colors: ['#1B1B3A'] } },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Anything in, a valid look out. Unknown values fall back, never throw. */
export function normalizeLook(raw) {
  const look = { ...DEFAULT_LOOK, ...(raw && typeof raw === 'object' ? raw : {}) };
  const valid = (Array.isArray(look.colors) ? look.colors : [])
    .filter(isHexColor)
    .map((c) => expandHex(c).toUpperCase())
    .slice(0, MAX_COLORS);
  const out = {
    v: 1,
    kind: KINDS.includes(look.kind) ? look.kind : 'glass',
    gradient: GRADIENTS.includes(look.gradient) ? look.gradient : 'linear',
    pattern: PATTERNS.includes(look.pattern) ? look.pattern : 'stripes',
    colors: valid.length ? valid : [...DEFAULT_LOOK.colors],
    angle: clamp(Math.round((Number(look.angle) || 0) / 5) * 5, 0, 355),
    scale: clamp(Math.round(Number(look.scale) || DEFAULT_LOOK.scale), 1, 10),
    inkMode: ['auto', 'dark', 'light'].includes(look.inkMode) ? look.inkMode : 'auto',
  };
  out.ink = inkFor(out);
  return out;
}

/** Applies a preset over the current look, keeping what the preset leaves open. */
export const applyPreset = (current, preset) => normalizeLook({ ...current, ...preset.look });

function expandHex(hex) {
  const clean = hex.replace('#', '');
  return `#${clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean}`;
}

const toRgb = (hex) => {
  const c = expandHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
};
const toHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** A colour mixed `t` of the way to another. */
export const mix = (a, b, t) => {
  const x = toRgb(a); const y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};

/** A colour 35% of the way to white: a one-colour pattern's second colour. */
export const tint = (hex) => mix(hex, '#FFFFFF', 0.35);

/**
 * The text colour the widget should use: dark on light looks, light on dark
 * ones. By the average luminance of the colours actually drawn, unless the
 * person chose. Grey glass is always dark text, as it has always been.
 */
export function inkFor(look) {
  if (look.inkMode === 'dark' || look.inkMode === 'light') return look.inkMode;
  if (look.kind === 'glass') return 'dark';
  const shown = look.kind === 'solid' ? look.colors.slice(0, 1) : look.colors;
  const avg = shown.reduce((sum, c) => sum + luminanceOf(c), 0) / shown.length;
  // 0.3, not 0.5: dark text stays readable further down than it looks, and
  // white text on a mid-bright colour is the worse mistake.
  return avg < 0.3 ? 'light' : 'dark';
}

/** The colours, padded by repetition to four, for the corner blend. */
export const blendCorners = (list) => [0, 1, 2, 3].map((i) => list[i % list.length]);

/** The numbers every renderer uses; see the notes at the top. */
export function geometry(look, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const a = (look.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const L = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
  return {
    cx, cy,
    start: [cx - dx * L, cy - dy * L],
    end: [cx + dx * L, cy + dy * L],
    radius: Math.hypot(w, h) / 2,
    cell: Math.min(w, h) * (0.02 + 0.04 * look.scale),
    // Half the diagonal: a turned pattern has to reach past every corner.
    reach: Math.hypot(w, h) / 2,
  };
}

/** Evenly spaced stop offsets for n colours. */
export const stops = (n) => (n === 1 ? [0] : Array.from({ length: n }, (_, i) => i / (n - 1)));

/** For the aurora band: offsets and white alphas across the gradient. */
export const AURORA_BAND = { at: 0.45, half: 0.12, alpha: 0.5 };

/** Floor-mod, so negative cells cycle the same way positive ones do. */
export const fmod = (a, n) => ((a % n) + n) % n;
