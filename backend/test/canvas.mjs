// The canvas gallery.
//
// The two assertions that matter: a gallery listing must not carry the full
// stroke data (that is the difference between a grid that loads and one that
// doesn't), and a drawing the other pair cannot see must really be invisible
// to them rather than merely unlinked.
const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 300)}`); } };

const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
};
const signup = async (n) => {
  const u = { email: `canvas-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const pairUp = async (a, b) => {
  const invite = await req('/auth/invite', { method: 'POST', token: a.token, body: { deviceTimezone: 'UTC' } });
  await req('/auth/invite/accept', { method: 'POST', token: b.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });
};

const A = await signup('Ana');
const B = await signup('Ben');
await pairUp(A, B);
const C = await signup('Cal');
const D = await signup('Dee');
await pairUp(C, D);

const stroke = (n, colour = '#FF5C8D') => ({
  points: Array.from({ length: n }, (_, i) => ({ x: i * 1.5, y: Math.sin(i) * 10 })),
  color: colour, width: 6, tool: 'pen',
});

console.log('=== SAVING A DRAWING ===');
const empty = await req('/canvas', { token: A.token });
check('the gallery starts empty', empty.status === 200 && empty.data.drawings.length === 0, empty.data);

const saved = await req('/canvas', {
  method: 'POST', token: A.token,
  body: { strokeData: { strokes: [stroke(20), stroke(35, '#3F63C6')] }, canvasColor: '#FFFDF8', title: '  us at the beach  ' },
});
check('a drawing saves', saved.status === 201, saved.data);
check('and its title is trimmed', saved.data.drawing.title === 'us at the beach', saved.data.drawing.title);
check('the author is recorded as both creator and last editor',
  saved.data.drawing.created_by === A.id && saved.data.drawing.updated_by === A.id, saved.data.drawing);

console.log('\n=== THE LISTING IS A LISTING, NOT A DOWNLOAD ===');
const list = await req('/canvas', { token: B.token });
check('the partner sees it', list.data.drawings.length === 1, list.data);
const row = list.data.drawings[0];
check('with a stroke count', row.stroke_count === 2, row);
check('and a preview to draw a thumbnail from', Array.isArray(row.preview) && row.preview.length === 2, row.preview?.length);
// The point of the split. A gallery of thirty drawings must not be thirty
// full stroke blobs.
check('but NOT the full stroke_data field', !('stroke_data' in row), Object.keys(row));

const one = await req(`/canvas/${row.id}`, { token: B.token });
check('fetching one drawing does return the strokes', one.data.drawing.stroke_data.strokes.length === 2, Object.keys(one.data.drawing));
check('and the canvas colour it was drawn on', one.data.drawing.canvas_color === '#FFFDF8');

console.log('\n=== EITHER OF YOU CAN ADD TO IT ===');
const added = await req(`/canvas/${row.id}`, {
  method: 'PUT', token: B.token,
  body: { strokeData: { strokes: [stroke(20), stroke(35, '#3F63C6'), stroke(12, '#3F8F5B')] } },
});
check('the partner can add a stroke', added.status === 200, added.data);
check('and becomes the last editor', added.data.drawing.updated_by === B.id, added.data.drawing);
check('while the original author is unchanged', added.data.drawing.created_by === A.id);
const reread = await req(`/canvas/${row.id}`, { token: A.token });
check('the new stroke is there', reread.data.drawing.stroke_data.strokes.length === 3);
// Not sent, so it must survive rather than reset to the default paper.
check('and the canvas colour survived an update that omitted it',
  reread.data.drawing.canvas_color === '#FFFDF8', reread.data.drawing.canvas_color);

console.log('\n=== JUNK IS REFUSED BEFORE IT REACHES THE OTHER PHONE ===');
// Each of these renders as a crash on the recipient's device, not here.
const bad = [
  ['no strokes at all', { strokeData: { strokes: [] } }],
  ['not an array', { strokeData: { strokes: 'hello' } }],
  ['a stroke with no points', { strokeData: { strokes: [{ color: '#000000' }] } }],
  ['a point that is not a number', { strokeData: { strokes: [{ points: [{ x: 'left', y: 2 }] }] } }],
  ['a NaN coordinate', { strokeData: { strokes: [{ points: [{ x: 0 / 0, y: 2 }] }] } }],
  ['too many strokes', { strokeData: { strokes: Array.from({ length: 4001 }, () => stroke(2)) } }],
];
for (const [label, body] of bad) {
  const r = await req('/canvas', { method: 'POST', token: A.token, body });
  check(`refused: ${label}`, r.status === 400, r);
}

// Junk that is merely wrong, rather than dangerous, is normalised instead.
const loose = await req('/canvas', {
  method: 'POST', token: A.token,
  body: { strokeData: [{ points: [{ x: 1.23456789, y: 2 }], color: 'rgb(1,2,3)', tool: 'chainsaw', width: 9999 }], canvasColor: 'periwinkle' },
});
check('a bare array of strokes is accepted too', loose.status === 201, loose.data);
const looseFull = await req(`/canvas/${loose.data.drawing.id}`, { token: A.token });
const s = looseFull.data.drawing.stroke_data.strokes[0];
check('an unknown tool falls back to the pen', s.tool === 'pen', s);
check('a non-hex colour falls back to black', s.color === '#000000', s);
check('an absurd width is clamped', s.width === 80, s);
check('an unknown paper falls back to the default', looseFull.data.drawing.canvas_color === '#FFFDF8');
check('and coordinates are rounded to a tenth', s.points[0].x === 1.2, s.points[0]);

console.log('\n=== TITLES AND PINNING ===');
const pinned = await req(`/canvas/${loose.data.drawing.id}`, { method: 'PATCH', token: B.token, body: { pinned: true } });
check('a drawing can be pinned', pinned.data.drawing.pinned === true, pinned.data);
const order = await req('/canvas', { token: A.token });
check('and sorts to the top regardless of age',
  order.data.drawings[0].id === loose.data.drawing.id, order.data.drawings.map((d) => d.id));

const cleared = await req(`/canvas/${row.id}`, { method: 'PATCH', token: A.token, body: { title: '   ' } });
check('a title can be cleared back to nothing', cleared.data.drawing.title === null, cleared.data.drawing);
const untouched = await req(`/canvas/${row.id}`, { method: 'PATCH', token: A.token, body: { pinned: false } });
check('and a patch that omits the title leaves it alone', untouched.data.drawing.title === null);

console.log('\n=== ANOTHER COUPLE SEES NONE OF IT ===');
const theirs = await req('/canvas', { token: C.token });
check('their gallery is empty', theirs.data.drawings.length === 0, theirs.data);
check('a direct fetch by id is a 404, not a read',
  (await req(`/canvas/${row.id}`, { token: C.token })).status === 404);
check('they cannot add to it', (await req(`/canvas/${row.id}`, { method: 'PUT', token: C.token, body: { strokeData: { strokes: [stroke(3)] } } })).status === 404);
check('they cannot rename it', (await req(`/canvas/${row.id}`, { method: 'PATCH', token: C.token, body: { title: 'mine now' } })).status === 404);
check('and they cannot delete it', (await req(`/canvas/${row.id}`, { method: 'DELETE', token: C.token })).status === 404);
check('signed out entirely is a 401', (await req('/canvas')).status === 401);

console.log('\n=== DELETING ===');
check('a drawing deletes', (await req(`/canvas/${row.id}`, { method: 'DELETE', token: B.token })).status === 204);
check('and is gone from the gallery',
  (await req('/canvas', { token: A.token })).data.drawings.every((d) => d.id !== row.id));
check('deleting it twice is a 404', (await req(`/canvas/${row.id}`, { method: 'DELETE', token: A.token })).status === 404);

console.log(`\nCANVAS RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
