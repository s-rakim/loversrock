// Builds a live 3D character from a wardrobe config (components/avatar/
// wardrobe.js) out of three.js primitives. No textures and no DOM APIs, so the
// same code runs under expo-gl on the phone and in a browser for previews.
//
// The returned rig exposes the joints the animator drives: shoulders and
// elbows, head, body, plus a face variant per emotion toggled by visibility.
// Units: the character is ~2.1 tall with feet on y = 0, facing +z.
import * as THREE from 'three';
import { normalizeAvatar } from '../avatar/wardrobe';

const INK = '#1B120D';

const matCache = new Map();
function mat(color, { rough = 0.62, metal = 0, emissive, transparent, opacity } = {}) {
  const key = `${color}|${rough}|${metal}|${emissive}|${opacity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal,
      ...(emissive ? { emissive, emissiveIntensity: 0.25 } : {}),
      ...(transparent ? { transparent: true, opacity } : {}),
    }));
  }
  return matCache.get(key);
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

function mesh(geometry, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.scale.set(sx, sy, sz);
  return m;
}

const sphere = (r, seg = 24) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
const capsule = (r, len, seg = 12) => new THREE.CapsuleGeometry(r, len, 6, seg);
const cyl = (rt, rb, h, seg = 20) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const arc = (r, tube, angle) => new THREE.TorusGeometry(r, tube, 8, 20, angle);

// Head geometry constants (head-local space).
const HEAD_R = 0.36;
// A point on the (slightly squashed) face surface for feature placement.
function onFace(x, y, lift = 0.004) {
  const z = Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - y * y)) * 0.93;
  return new THREE.Vector3(x, y, z + lift);
}

function heartShape(size) {
  const s = new THREE.Shape();
  s.moveTo(0, -size * 0.9);
  s.bezierCurveTo(-size * 1.3, -size * 0.1, -size * 0.7, size, 0, size * 0.35);
  s.bezierCurveTo(size * 0.7, size, size * 1.3, -size * 0.1, 0, -size * 0.9);
  return new THREE.ShapeGeometry(s);
}

function buildFace(emotion) {
  const g = new THREE.Group();
  const ink = mat(INK, { rough: 0.3 });
  const white = mat('#FFFFFF', { rough: 0.3 });

  const eyeKind = {
    happy: 'laugh', excited: 'laugh', love: 'heart', calm: 'closed', sleepy: 'sleepy', sick: 'sleepy',
  }[emotion] || 'open';

  const eyes = new THREE.Group();
  eyes.name = 'eyes';
  for (const side of [-1, 1]) {
    const p = onFace(0.12 * side, 0.04);
    if (eyeKind === 'open') {
      const e = mesh(sphere(0.046, 16), ink, { x: p.x, y: p.y, z: p.z - 0.01, sz: 0.55, sy: 1.15 });
      e.name = 'eyeball';
      eyes.add(e);
      eyes.add(mesh(sphere(0.013, 8), white, { x: p.x + 0.014, y: p.y + 0.018, z: p.z + 0.012 }));
    } else if (eyeKind === 'heart') {
      eyes.add(mesh(heartShape(0.05), mat('#E8364F', { rough: 0.35 }), { x: p.x, y: p.y, z: p.z + 0.004, ry: 0.32 * side }));
    } else {
      // Closed arcs: ∩ for laughing, ∪ for calm/sleepy.
      const up = eyeKind === 'laugh';
      eyes.add(mesh(arc(0.05, 0.012, Math.PI), ink, { x: p.x, y: p.y + (up ? -0.02 : 0.02), z: p.z, rz: up ? 0 : Math.PI, ry: 0.32 * side }));
    }
  }
  g.add(eyes);

  // Brows.
  const browTilt = { angry: -0.45, sad: 0.35, missing: 0.35, anxious: 0.3, sick: 0.25, happy: 0.08, excited: 0.1, love: 0.08 }[emotion] || 0;
  const browLift = ['happy', 'excited', 'love', 'missing'].includes(emotion) ? 0.02 : 0;
  for (const side of [-1, 1]) {
    const p = onFace(0.12 * side, 0.135 + browLift);
    g.add(mesh(capsule(0.011, 0.07, 6), ink, { x: p.x, y: p.y, z: p.z, rz: Math.PI / 2 + browTilt * side, ry: 0.3 * side }));
  }

  // Blush.
  const blush = mat(emotion === 'sick' ? '#8FCB9B' : '#E8607A', { transparent: true, opacity: 0.35 });
  for (const side of [-1, 1]) {
    const p = onFace(0.2 * side, -0.07, 0.006);
    g.add(mesh(new THREE.CircleGeometry(0.05, 20), blush, { x: p.x, y: p.y, z: p.z, ry: 0.55 * side }));
  }

  // Mouth.
  const m = onFace(0, -0.15, 0.006);
  if (emotion === 'happy' || emotion === 'excited') {
    const big = emotion === 'excited' ? 1.2 : 1;
    const mouth = new THREE.Group();
    mouth.add(mesh(new THREE.CircleGeometry(0.09 * big, 32, Math.PI, Math.PI), mat('#4A1414', { rough: 0.5 })));
    mouth.add(mesh(box(0.13 * big, 0.024, 0.004), white, { y: -0.012, z: 0.002 }));
    mouth.add(mesh(new THREE.CircleGeometry(0.035 * big, 20, Math.PI, Math.PI), mat('#E86A7A'), { y: -0.05 * big, z: 0.003, sy: 0.7 }));
    mouth.position.copy(m);
    g.add(mouth);
  } else if (emotion === 'sleepy' || emotion === 'missing') {
    g.add(mesh(sphere(emotion === 'missing' ? 0.02 : 0.026, 12), mat('#4A1414'), { x: m.x, y: m.y, z: m.z - 0.008, sz: 0.4 }));
  } else if (emotion === 'love' || emotion === 'calm') {
    g.add(mesh(arc(emotion === 'love' ? 0.06 : 0.045, 0.013, Math.PI), ink, { x: m.x, y: m.y + 0.03, z: m.z, rz: Math.PI }));
  } else if (emotion === 'sad') {
    g.add(mesh(arc(0.055, 0.013, Math.PI), ink, { x: m.x, y: m.y - 0.035, z: m.z }));
  } else if (emotion === 'anxious' || emotion === 'sick') {
    for (let i = -1; i <= 1; i += 2) {
      g.add(mesh(arc(0.025, 0.011, Math.PI), ink, { x: m.x + i * 0.025, y: m.y, z: m.z, rz: i > 0 ? Math.PI : 0 }));
    }
  } else {
    g.add(mesh(capsule(0.012, emotion === 'angry' ? 0.09 : 0.06, 6), ink, { x: m.x, y: m.y, z: m.z, rz: Math.PI / 2 }));
  }
  return g;
}

function buildHair(style, color) {
  const g = new THREE.Group();
  const hair = mat(color, { rough: 0.85 });
  const hairLight = mat(shade(color, 0.05), { rough: 0.85 });
  const cap = (scale = 1.045, theta = 1.2) =>
    mesh(new THREE.SphereGeometry(HEAD_R * scale, 32, 18, 0, Math.PI * 2, 0, theta), hair, { sz: 0.95, rx: -0.18 });

  switch (style) {
    case 'puff':
      g.add(cap(1.04, 1.15));
      g.add(mesh(sphere(0.19, 28), hair, { y: 0.36, z: -0.1 }));
      for (let i = 0; i < 14; i += 1) {
        const a = (i / 14) * Math.PI * 2;
        g.add(mesh(sphere(0.05, 10), hairLight, { x: Math.cos(a) * 0.14, y: 0.36 + Math.sin(a * 2) * 0.08, z: -0.1 + Math.sin(a) * 0.14 }));
      }
      g.add(mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 24), mat(shade(color, 0.12)), { y: 0.25, z: -0.08, rx: Math.PI / 2.4 }));
      break;
    case 'twists': {
      g.add(cap(1.03, 1.3));
      // Short twists all over the crown, pointing outward along the normal,
      // plus a few falling onto the forehead.
      const up = new THREE.Vector3(0, 1, 0);
      for (let ring = 0; ring < 5; ring += 1) {
        const theta = 0.15 + ring * 0.27;
        const count = 8 + ring * 5;
        for (let i = 0; i < count; i += 1) {
          const phi = (i / count) * Math.PI * 2 + ring * 0.3;
          const n = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
          if (n.z > 0.55 && n.y < 0.55) continue; // keep the face clear
          const t = mesh(capsule(0.036, 0.11, 8), i % 2 ? hair : hairLight);
          t.position.copy(n.clone().multiplyScalar(HEAD_R * 1.1));
          t.position.y += 0.02;
          t.quaternion.setFromUnitVectors(up, n);
          g.add(t);
        }
      }
      for (const [x, rz] of [[-0.12, 0.25], [0, 0], [0.12, -0.25], [-0.2, 0.5], [0.2, -0.5]]) {
        g.add(mesh(capsule(0.034, 0.1, 8), hair, { x, y: 0.25, z: 0.26, rx: 0.5, rz }));
      }
      break;
    }
    case 'afro':
      g.add(mesh(sphere(0.5, 32), hair, { y: 0.12, z: -0.2, sz: 0.78 }));
      break;
    case 'bun':
      g.add(cap());
      g.add(mesh(sphere(0.14, 20), hair, { y: 0.34, z: -0.2 }));
      break;
    case 'long':
      g.add(cap(1.05, 1.35));
      g.add(mesh(capsule(0.3, 0.45, 20), hair, { y: -0.28, z: -0.14, sx: 1.15, sz: 0.55 }));
      break;
    case 'braids':
      g.add(cap(1.04, 1.3));
      for (const side of [-1, 1]) {
        for (let i = 0; i < 9; i += 1) g.add(mesh(sphere(0.055, 12), hair, { x: side * (0.34 + i * 0.004), y: -0.02 - i * 0.085, z: -0.04 }));
      }
      break;
    case 'short':
      g.add(cap(1.05, 1.1));
      g.add(mesh(sphere(0.12, 16), hair, { x: 0.05, y: 0.33, z: 0.14, sy: 0.6 }));
      break;
    case 'buzz':
      g.add(cap(1.015, 1.2));
      break;
    default:
      g.add(cap());
  }
  return g;
}

// Two-bone arm: shoulder pivot → upper arm → elbow pivot → forearm + hand.
function buildArm(side, { skin, sleeveColor, sleeve, cuff }) {
  const shoulder = new THREE.Group();
  shoulder.position.set(0.3 * side, 1.27, 0);
  const upperLen = 0.26;
  const foreLen = 0.24;
  const skinM = mat(skin);

  const upper = mesh(capsule(0.058, upperLen - 0.06), skinM, { y: -upperLen / 2 });
  shoulder.add(upper);
  if (sleeve > 0) {
    const sleeveLen = Math.min(1, sleeve * 2) * upperLen;
    shoulder.add(mesh(capsule(0.078, Math.max(0.02, sleeveLen - 0.07)), mat(sleeveColor), { y: -sleeveLen / 2 + 0.01 }));
    if (cuff && sleeve < 0.5) shoulder.add(mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20), mat(cuff), { y: -sleeveLen + 0.02, rx: Math.PI / 2 }));
  }
  const elbow = new THREE.Group();
  elbow.position.y = -upperLen;
  shoulder.add(elbow);
  elbow.add(mesh(capsule(0.052, foreLen - 0.05), skinM, { y: -foreLen / 2 }));
  if (sleeve > 0.5) elbow.add(mesh(capsule(0.072, (sleeve - 0.5) * 2 * foreLen), mat(sleeveColor), { y: -((sleeve - 0.5) * 2 * foreLen) / 2 }));
  const hand = new THREE.Group();
  hand.position.y = -foreLen - 0.02;
  hand.add(mesh(sphere(0.068, 14), skinM, { sz: 0.8 }));
  elbow.add(hand);
  return { shoulder, elbow, hand };
}

function buildLegs(avatar, skin) {
  const g = new THREE.Group();
  const { bottom, top, socks, shoes } = avatar;
  const dress = top.style === 'dress';
  const skinM = mat(skin);
  const cloth = mat(bottom.color, { rough: 0.8 });
  const clothDark = mat(shade(bottom.color, -0.08), { rough: 0.8 });
  const legLen = 0.64;

  for (const side of [-1, 1]) {
    const x = 0.11 * side;
    g.add(mesh(capsule(0.075, legLen - 0.1), skinM, { x, y: 0.08 + legLen / 2 }));
    if (!dress) {
      if (bottom.style === 'jeans' || bottom.style === 'joggers') {
        const len = bottom.style === 'jeans' ? legLen - 0.02 : legLen - 0.06;
        g.add(mesh(cyl(0.1, bottom.style === 'jeans' ? 0.098 : 0.085, len), cloth, { x, y: 0.72 - len / 2 }));
        if (bottom.style === 'joggers') g.add(mesh(cyl(0.088, 0.088, 0.05), clothDark, { x, y: 0.72 - len + 0.02 }));
      } else if (bottom.style === 'cargo_shorts' || bottom.style === 'shorts') {
        const len = bottom.style === 'cargo_shorts' ? 0.32 : 0.22;
        g.add(mesh(cyl(0.118, 0.125, len), cloth, { x, y: 0.72 - len / 2 }));
        if (bottom.style === 'cargo_shorts') g.add(mesh(box(0.035, 0.1, 0.1), clothDark, { x: x + 0.12 * side, y: 0.52, z: 0 }));
      }
    }
    const bareShin = dress || ['cargo_shorts', 'shorts', 'skirt'].includes(bottom.style);
    if (socks && bareShin && shoes.style !== 'boots') g.add(mesh(cyl(0.08, 0.08, 0.2), mat('#F4F4F4', { rough: 0.9 }), { x, y: 0.17 }));
  }
  if (!dress) {
    if (bottom.style === 'skirt') g.add(mesh(cyl(0.22, 0.34, 0.34, 28), cloth, { y: 0.58 }));
    else g.add(mesh(cyl(0.225, 0.215, 0.12, 28), cloth, { y: 0.74, sz: 0.75 }));
  }
  return g;
}

function buildShoes(shoes, skin) {
  const g = new THREE.Group();
  const c = shoes.color || '#222222';
  for (const side of [-1, 1]) {
    const x = 0.11 * side;
    switch (shoes.style) {
      case 'slides':
        g.add(mesh(sphere(0.075, 14), mat(skin), { x, y: 0.055, z: 0.05, sx: 0.9, sy: 0.55, sz: 1.5 }));
        g.add(mesh(box(0.16, 0.035, 0.27), mat(c), { x, y: 0.018, z: 0.04 }));
        g.add(mesh(box(0.17, 0.05, 0.1), mat(shade(c, -0.08)), { x, y: 0.07, z: 0.08 }));
        break;
      case 'boots':
        g.add(mesh(cyl(0.09, 0.09, 0.26), mat(c), { x, y: 0.14 }));
        g.add(mesh(box(0.17, 0.08, 0.26), mat(c), { x, y: 0.05, z: 0.05 }));
        g.add(mesh(box(0.18, 0.025, 0.28), mat(shade(c, -0.2)), { x, y: 0.012, z: 0.05 }));
        break;
      case 'heels':
        g.add(mesh(sphere(0.08, 14), mat(c), { x, y: 0.07, z: 0.06, sx: 0.9, sy: 0.5, sz: 1.5 }));
        g.add(mesh(cyl(0.015, 0.012, 0.08), mat(c), { x, y: 0.04, z: -0.06 }));
        break;
      case 'barefoot':
        g.add(mesh(sphere(0.075, 14), mat(skin), { x, y: 0.05, z: 0.05, sx: 0.9, sy: 0.55, sz: 1.5 }));
        break;
      default: // sneakers
        g.add(mesh(sphere(0.09, 16), mat(c), { x, y: 0.07, z: 0.06, sx: 1, sy: 0.7, sz: 1.55 }));
        g.add(mesh(box(0.18, 0.04, 0.3), mat('#FFFFFF', { rough: 0.7 }), { x, y: 0.02, z: 0.06 }));
        g.add(mesh(box(0.06, 0.012, 0.08), mat('#FFFFFF'), { x, y: 0.12, z: 0.12, rx: -0.5 }));
    }
  }
  return g;
}

function buildTorso(top, skin) {
  const g = new THREE.Group();
  const c = mat(top.color, { rough: 0.75 });
  const dark = mat(shade(top.color, -0.08), { rough: 0.75 });
  const white = mat('#FFFFFF', { rough: 0.7 });
  g.add(mesh(capsule(0.24, 0.3, 24), c, { y: 1.02, sx: 1.08, sz: 0.74 }));

  switch (top.style) {
    case 'jersey':
      for (const side of [-1, 1]) g.add(mesh(box(0.1, 0.035, 0.12), white, { x: 0.06 * side, y: 1.31, z: 0.1, rz: -0.55 * side, rx: 0.3 }));
      g.add(mesh(box(0.018, 0.1, 0.01), mat('#C62828'), { y: 1.22, z: 0.178 }));
      g.add(mesh(new THREE.CircleGeometry(0.03, 16), white, { x: 0.1, y: 1.15, z: 0.182 }));
      // Subtle diagonal pinstripes on the front panel.
      for (let i = -3; i <= 3; i += 1) g.add(mesh(box(0.012, 0.36, 0.004), mat(shade(top.color, 0.06)), { x: i * 0.06, y: 1.0, z: 0.18, rz: 0.45 }));
      break;
    case 'hoodie':
      g.add(mesh(new THREE.TorusGeometry(0.14, 0.05, 10, 24), dark, { y: 1.3, z: -0.05, rx: Math.PI / 2.4 }));
      g.add(mesh(box(0.26, 0.1, 0.02), dark, { y: 0.9, z: 0.17 }));
      for (const side of [-1, 1]) g.add(mesh(cyl(0.006, 0.006, 0.12), white, { x: 0.04 * side, y: 1.18, z: 0.18 }));
      break;
    case 'shirt':
      for (const side of [-1, 1]) g.add(mesh(box(0.09, 0.03, 0.1), dark, { x: 0.055 * side, y: 1.31, z: 0.1, rz: -0.55 * side, rx: 0.3 }));
      for (let i = 0; i < 4; i += 1) g.add(mesh(sphere(0.012, 8), dark, { y: 1.2 - i * 0.09, z: 0.18 }));
      break;
    case 'dress':
      g.add(mesh(cyl(0.24, 0.42, 0.52, 32), c, { y: 0.62 }));
      g.add(mesh(cyl(0.245, 0.245, 0.04, 32), dark, { y: 0.87 }));
      break;
    case 'tank':
      g.add(mesh(sphere(0.12, 16), mat(skin), { y: 1.28, z: 0.05, sx: 1.4, sy: 0.6, sz: 0.8 }));
      break;
    default:
      break;
  }
  return g;
}

const SLEEVE = { fitted_long: 1, hoodie: 1, jersey: 0.42, tee: 0.36, shirt: 0.45, tank: 0, dress: 0.2 };

/**
 * Returns { root, parts } — root is a THREE.Group to add to a scene; parts
 * are the joints and toggles animate.js drives.
 */
export function buildCharacter(rawAvatar) {
  const avatar = normalizeAvatar(rawAvatar);
  const { skin, hair, top, shoes, accessories } = avatar;
  const has = (a) => accessories.includes(a);
  const skinM = mat(skin);

  const root = new THREE.Group();   // placement in the scene
  const body = new THREE.Group();   // bob / breathe / sway / spin
  root.add(body);

  body.add(buildLegs(avatar, skin));
  body.add(buildShoes(shoes, skin));
  body.add(buildTorso(top, skin));

  const sleeve = SLEEVE[top.style] ?? 0.5;
  const cuff = top.style === 'jersey' ? '#FFFFFF' : null;
  const armL = buildArm(-1, { skin, sleeveColor: top.color, sleeve, cuff });
  const armR = buildArm(1, { skin, sleeveColor: top.color, sleeve, cuff });
  body.add(armL.shoulder, armR.shoulder);

  if (has('watch')) armL.elbow.add(mesh(new THREE.TorusGeometry(0.058, 0.014, 8, 20), mat('#D9A441', { rough: 0.3, metal: 0.7 }), { y: -0.2, rx: Math.PI / 2 }));
  if (has('microphone')) {
    const mic = new THREE.Group();
    mic.add(mesh(cyl(0.022, 0.016, 0.2), mat('#2B2B2B', { rough: 0.4 }), { y: 0.08 }));
    mic.add(mesh(sphere(0.05, 16), mat('#9E9E9E', { rough: 0.35, metal: 0.5 }), { y: 0.2 }));
    mic.rotation.x = -0.6;
    mic.position.z = 0.04;
    armR.hand.add(mic);
  }

  body.add(mesh(cyl(0.075, 0.085, 0.14), mat(shade(skin, -0.03)), { y: 1.36 }));
  if (has('necklace')) body.add(mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 28), mat('#D9A441', { rough: 0.3, metal: 0.7 }), { y: 1.31, z: 0.02, rx: Math.PI / 2.3 }));

  // Head.
  const head = new THREE.Group();
  head.position.y = 1.74;
  body.add(head);
  head.add(mesh(sphere(HEAD_R, 40), skinM, { sz: 0.93, sy: 1.02 }));
  head.add(mesh(sphere(0.03, 10), mat(shade(skin, -0.04)), { y: -0.05, z: HEAD_R * 0.93 + 0.012 }));
  for (const side of [-1, 1]) head.add(mesh(sphere(0.075, 14), skinM, { x: 0.345 * side, y: 0.0, sz: 0.5 }));

  const faces = {};
  for (const emotion of ['neutral', 'happy', 'love', 'excited', 'calm', 'missing', 'sleepy', 'sad', 'angry', 'anxious', 'sick']) {
    const f = buildFace(emotion);
    f.visible = false;
    head.add(f);
    faces[emotion] = f;
  }
  head.add(buildHair(hair.style, hair.color));

  if (has('hoops') || has('studs')) {
    for (const side of [-1, 1]) {
      head.add(has('hoops')
        ? mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 24), mat('#D9A441', { rough: 0.25, metal: 0.8 }), { x: 0.36 * side, y: -0.11, z: 0.01, ry: Math.PI / 2 })
        : mesh(sphere(0.016, 8), mat('#E0E0E0', { rough: 0.2, metal: 0.8 }), { x: 0.37 * side, y: -0.06 }));
    }
  }
  if (has('glasses') || has('sunglasses')) {
    const frame = mat(INK, { rough: 0.3 });
    for (const side of [-1, 1]) {
      const p = onFace(0.12 * side, 0.04, 0.03);
      head.add(mesh(new THREE.TorusGeometry(0.07, 0.01, 8, 24), frame, { x: p.x, y: p.y, z: p.z, ry: 0.3 * side }));
      if (has('sunglasses')) head.add(mesh(new THREE.CircleGeometry(0.066, 24), mat('#111111', { rough: 0.1, transparent: true, opacity: 0.85 }), { x: p.x, y: p.y, z: p.z + 0.002, ry: 0.3 * side }));
    }
    const b = onFace(0, 0.05, 0.035);
    head.add(mesh(box(0.08, 0.012, 0.01), frame, { x: 0, y: b.y, z: b.z }));
  }
  if (has('cap')) {
    const capColor = top.color === '#FFFFFF' ? '#222222' : shade(top.color, -0.05);
    head.add(mesh(new THREE.SphereGeometry(HEAD_R * 1.08, 32, 16, 0, Math.PI * 2, 0, 1.25), mat(capColor), { y: 0.03, rx: -0.12 }));
    head.add(mesh(cyl(0.2, 0.2, 0.02, 24), mat(shade(capColor, -0.1)), { y: 0.2, z: 0.3, sx: 1, sz: 0.9, rx: 0.2 }));
  }
  if (has('beanie')) {
    head.add(mesh(new THREE.SphereGeometry(HEAD_R * 1.1, 32, 16, 0, Math.PI * 2, 0, 1.3), mat('#C62828', { rough: 0.9 }), { y: 0.04, rx: -0.1 }));
    head.add(mesh(new THREE.TorusGeometry(HEAD_R * 1.02, 0.045, 10, 32), mat('#A31515', { rough: 0.9 }), { y: 0.14, rx: Math.PI / 2 - 0.1 }));
    head.add(mesh(sphere(0.07, 14), mat('#EEEEEE', { rough: 1 }), { y: 0.45 }));
  }
  if (has('flower')) {
    const f = new THREE.Group();
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      f.add(mesh(sphere(0.035, 10), mat('#F48FB1'), { x: Math.cos(a) * 0.04, y: Math.sin(a) * 0.04, sz: 0.5 }));
    }
    f.add(mesh(sphere(0.025, 10), mat('#F9A825'), { z: 0.01 }));
    f.position.set(0.25, 0.25, 0.2);
    f.rotation.y = 0.6;
    head.add(f);
  }

  return { root, parts: { body, head, armL, armR, faces } };
}
