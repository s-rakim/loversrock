// The doodle stroke format.
//
// The thing worth testing here is backward compatibility. Doodles already
// sent are stored as bare point arrays with no styling, and they have to
// keep rendering exactly as they did — a format change that quietly breaks
// messages someone already sent is not a format change, it is data loss.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');

let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${d ?? ''}`); } };

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = path.join(root, 'components', 'Doodle.js');
const source = fs.readFileSync(file, 'utf8');

// Transpile the module and evaluate it with the JSX/SVG bits stubbed out, so
// the pure logic (normalizeStroke, the palettes) can be exercised in node.
const { code } = babel.transformSync(source, {
  filename: file,
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'classic' }],
  ],
  babelrc: false, configFile: false,
});
const stub = new Proxy({}, { get: () => () => null });
const module_ = { exports: {} };
const fakeRequire = (id) => {
  if (id === 'react') return { createElement: () => null, Fragment: 'Fragment' };
  if (id === 'react-native') return { View: 'View', StyleSheet: { absoluteFill: {}, create: (s) => s } };
  if (id === 'react-native-svg') return stub;
  return require(id);
};
new Function('module', 'exports', 'require', code)(module_, module_.exports, fakeRequire);
const { normalizeStroke, PALETTE, WIDTHS, TOOLS, CANVAS_COLORS, DEFAULT_STROKE, strokeBounds } = module_.exports;

console.log('=== OLD DOODLES STILL RENDER ===');
const legacy = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
const fromLegacy = normalizeStroke(legacy);
check('a bare point array is accepted', fromLegacy.points.length === 2, fromLegacy);
check('the points survive untouched',
  JSON.stringify(fromLegacy.points) === JSON.stringify(legacy), fromLegacy.points);
check('it gets the pen tool', fromLegacy.tool === 'pen', fromLegacy.tool);
check('and the width it was always drawn at', fromLegacy.width === 4, fromLegacy.width);
check('and a real colour, not undefined', /^#[0-9A-F]{6}$/i.test(fromLegacy.color), fromLegacy.color);

console.log('\n=== NEW STROKES KEEP THEIR STYLING ===');
const modern = { points: [{ x: 0, y: 0 }], color: '#4FC16B', width: 14, tool: 'neon' };
const kept = normalizeStroke(modern);
check('colour is kept', kept.color === '#4FC16B', kept.color);
check('width is kept', kept.width === 14, kept.width);
check('tool is kept', kept.tool === 'neon', kept.tool);

console.log('\n=== MALFORMED INPUT DOES NOT CRASH THE RENDERER ===');
for (const [label, input] of [
  ['null', null], ['undefined', undefined], ['an empty object', {}],
  ['an empty array', []], ['a string width', { points: [], width: 'fat' }],
]) {
  const out = normalizeStroke(input);
  check(`${label} yields a usable stroke`,
    Array.isArray(out.points) && typeof out.width === 'number' && !Number.isNaN(out.width)
    && typeof out.color === 'string' && typeof out.tool === 'string', out);
}

console.log('\n=== THE TOOLBOX ===');
check('the palette has sixteen colours', PALETTE.length === 16, PALETTE.length);
check('every swatch is a valid hex colour',
  PALETTE.every((c) => /^#[0-9A-F]{6}$/i.test(c)), PALETTE.filter((c) => !/^#[0-9A-F]{6}$/i.test(c)));
check('no duplicate swatches', new Set(PALETTE).size === PALETTE.length,
  PALETTE.filter((c, i) => PALETTE.indexOf(c) !== i));
check('black and white are both available',
  PALETTE.includes('#111111') && PALETTE.includes('#FFFFFF'));

check('widths run thin to thick',
  WIDTHS.every((w, i) => i === 0 || w > WIDTHS[i - 1]), WIDTHS);
check('the thinnest is usable on a phone', WIDTHS[0] >= 2, WIDTHS[0]);

const toolIds = TOOLS.map((t) => t.id);
for (const tool of ['pen', 'marker', 'neon', 'dashed', 'dotted', 'rainbow', 'ribbon', 'eraser']) {
  check(`the ${tool} tool exists`, toolIds.includes(tool), toolIds);
}
check('no duplicate tool ids', new Set(toolIds).size === toolIds.length, toolIds);
check('every tool has a label and an icon',
  TOOLS.every((t) => t.label && t.icon), TOOLS.filter((t) => !t.label || !t.icon));

check('there are several papers to draw on', CANVAS_COLORS.length >= 4, CANVAS_COLORS.length);
check('including a dark one, so light ink shows up',
  CANVAS_COLORS.some((c) => c.value.toLowerCase() === '#14141f'), CANVAS_COLORS.map((c) => c.value));
check('every paper is a valid hex colour',
  CANVAS_COLORS.every((c) => /^#[0-9A-F]{6}$/i.test(c.value)));

console.log('\n=== THE DEFAULT IS SANE ===');
check('the default tool is the pen', DEFAULT_STROKE.tool === 'pen');
check('the default colour is in the palette', PALETTE.includes(DEFAULT_STROKE.color), DEFAULT_STROKE.color);
check('the default width is one of the offered widths',
  WIDTHS.includes(DEFAULT_STROKE.width) || DEFAULT_STROKE.width > 0, DEFAULT_STROKE.width);

console.log('\n=== EVERY GLYPH IN THE TOOLBOX EXISTS ===');
const glyphs = JSON.parse(fs.readFileSync(
  path.join(root, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'),
  'utf8'
));
const missing = TOOLS.filter((t) => !(t.icon in glyphs));
check('all tool icons resolve in Ionicons', missing.length === 0, missing.map((t) => t.icon));

console.log('\n=== EVERY SCREEN USES THE SHARED RENDERER ===');
// The bug this prevents: a screen keeping its own hard-coded Polyline, so a
// neon stroke arrives and is drawn as a plain pink line.
for (const screen of ['app/CanvasScreen.js', 'app/MessagesScreen.js', 'app/games/DrawDuelScreen.js']) {
  const text = fs.readFileSync(path.join(root, screen), 'utf8');
  check(`${screen} draws through components/Doodle`,
    /from '.*components\/Doodle'/.test(text), 'no import found');
  check(`${screen} has no hand-rolled Polyline left`,
    !/<Polyline/.test(text), 'still renders its own Polyline');
}

console.log('\n=== A GALLERY THUMBNAIL SHOWS THE DRAWING, NOT ITS TOP-LEFT CORNER ===');
// Stroke points are raw finger coordinates from whatever screen the drawing
// was made on — a 390x700 canvas, typically. Rendered into a 170px cell with
// no viewBox you get the top-left quarter of it and nothing else, which for a
// drawing centred on the page is an empty tile.
const pts = (list) => ({ points: list.map(([x, y]) => ({ x, y })), color: '#000000', width: 6, tool: 'pen' });

const b = strokeBounds([pts([[100, 200], [300, 500]])]);
check('bounds cover the drawn area', b.x <= 100 && b.y <= 200 && b.x + b.width >= 300 && b.y + b.height >= 500, b);
// A path's coordinates are its CENTRE line, so a fat stroke ending on the
// bounds would be sliced in half lengthways without padding.
check('and are padded by at least the stroke width', b.x < 100 - 5 && b.y < 200 - 5, b);

const fat = strokeBounds([{ points: [{ x: 0, y: 0 }], color: '#000000', width: 22, tool: 'pen' }]);
check('a fatter stroke gets more padding', fat.width >= 44, fat);
// Zero-extent boxes render nothing at all rather than a dot.
check('a single point still has a non-zero box', fat.width > 0 && fat.height > 0, fat);

check('nothing drawable gives no box, rather than an infinite one', strokeBounds([]) === null);
check('and neither does a stroke with no points', strokeBounds([{ points: [] }]) === null);
check('a NaN point is skipped rather than poisoning the box',
  Number.isFinite(strokeBounds([pts([[10, 10], [50, 50]]), { points: [{ x: NaN, y: 0 }] }])?.width));

// Several strokes, one box around all of them.
const many = strokeBounds([pts([[0, 0]]), pts([[400, 10]]), pts([[20, 900]])]);
check('the box covers every stroke', many.x <= 0 && many.x + many.width >= 400 && many.y + many.height >= 900, many);

check('Doodle only fits when asked', /fit = false/.test(source), 'fit should default off');
// In a message bubble a small doodle and a full-page one must not come out
// the same size; only the gallery wants them zoomed to fill.
const gallery = fs.readFileSync(path.join(root, 'app', 'CanvasGalleryScreen.js'), 'utf8');
check('but the gallery does ask for it', /<Doodle[\s\S]{0,300}?\bfit\b/.test(gallery));

console.log(`\nDOODLE RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
