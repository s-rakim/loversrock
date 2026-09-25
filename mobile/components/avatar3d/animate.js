// Drives a rig from buildCharacter.js every frame: mood-dependent pose, face,
// head motion, breathing, a gentle 3D sway, blinking, and tap reactions
// (wave + spin). Pure math on three.js objects — no React, no timers.

const TAU = Math.PI * 2;

// Joint targets per pose: [upper.z, upper.x, elbow.z, elbow.x] for the RIGHT
// arm; the left arm mirrors z. upper.z > 0 lifts the arm out to the side.
const POSES = {
  down: { r: [0.12, 0, 0.12, 0], l: [0.12, 0, 0.12, 0] },
  heart: { r: [0.35, -0.9, -0.2, -1.5], l: [0.35, -0.9, -0.2, -1.5] },
  hips: { r: [0.75, 0, -1.9, 0], l: [0.75, 0, -1.9, 0] },
  hug: { r: [1.35, -0.7, 0.15, 0], l: [1.35, -0.7, 0.15, 0] },
  cheer: { r: [2.7, 0, 0.3, 0], l: [2.7, 0, 0.3, 0] },
  droop: { r: [0.05, 0.1, 0.05, 0], l: [0.05, 0.1, 0.05, 0] },
  sing: { r: [0.3, -0.5, 0.2, -2.1], l: [0.18, 0, 0.12, 0] },
};

export const EMOTION_STYLE = {
  neutral: { pose: 'down', bob: 0.012, speed: 1.6, tilt: 0 },
  happy: { pose: 'down', bob: 0.03, speed: 3.2, tilt: 0.06, nod: 0.05 },
  love: { pose: 'heart', bob: 0.018, speed: 2.2, tilt: 0.12 },
  excited: { pose: 'cheer', bob: 0.06, speed: 6, tilt: 0, bounce: true },
  calm: { pose: 'down', bob: 0.01, speed: 1, tilt: 0.05 },
  missing: { pose: 'hug', bob: 0.01, speed: 1.2, tilt: 0.1, look: 0.35 },
  sleepy: { pose: 'droop', bob: 0.008, speed: 0.8, tilt: 0.28, droop: true },
  sad: { pose: 'droop', bob: 0.006, speed: 0.9, tilt: -0.12, headDown: 0.25 },
  angry: { pose: 'hips', bob: 0.004, speed: 1, tilt: 0, shake: true },
  anxious: { pose: 'down', bob: 0.006, speed: 1.4, tilt: 0, jitter: true },
  sick: { pose: 'droop', bob: 0.005, speed: 0.7, tilt: 0.18, headDown: 0.12 },
};

const lerp = (a, b, k) => a + (b - a) * k;

function driveArm(arm, target, side, k) {
  const [uz, ux, ez, ex] = target;
  arm.shoulder.rotation.z = lerp(arm.shoulder.rotation.z, uz * side, k);
  arm.shoulder.rotation.x = lerp(arm.shoulder.rotation.x, ux, k);
  arm.elbow.rotation.z = lerp(arm.elbow.rotation.z, ez * side, k);
  arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, ex, k);
}

/**
 * state: { emotion, t (seconds), dt, blink (0..1 closed amount), waveUntil,
 *          spinStart, phase (per-character offset), microphone (bool) }
 */
export function animateCharacter(rig, state) {
  const { body, head, armL, armR, faces } = rig.parts;
  const emotion = EMOTION_STYLE[state.emotion] ? state.emotion : 'neutral';
  const style = EMOTION_STYLE[emotion];
  const t = state.t + (state.phase || 0);
  const k = Math.min(1, (state.dt || 0.016) * 8);

  // Face variant for this mood.
  for (const [name, face] of Object.entries(faces)) face.visible = name === emotion;
  const eyes = faces[emotion].getObjectByName('eyes');
  if (eyes) eyes.scale.y = 1 - 0.9 * (state.blink || 0);

  // Body: bob, breathe, gentle sway so the 3D reads, optional bounce/shake.
  const bob = Math.sin(t * style.speed) * style.bob;
  const bounce = style.bounce ? Math.abs(Math.sin(t * style.speed)) * 0.06 : 0;
  body.position.y = bob + bounce + (state.hop || 0);
  const breathe = 1 + Math.sin(t * 1.8) * 0.012;
  body.scale.set(1, breathe, 1);
  let spin = 0;
  if (state.spinStart !== undefined && state.spinStart !== null) {
    const p = Math.min(1, (state.t - state.spinStart) / 1.1);
    spin = TAU * (1 - (1 - p) ** 3);
  }
  body.rotation.y = Math.sin(t * 0.6) * 0.28 + spin;
  body.position.x = style.shake ? Math.sin(t * 40) * 0.008 * (Math.sin(t * 2) > 0.3 ? 1 : 0)
    : style.jitter ? Math.sin(t * 55) * 0.004 : 0;

  // Head.
  head.rotation.z = lerp(head.rotation.z, style.tilt + (style.droop ? Math.sin(t * 0.8) * 0.06 : 0), k);
  head.rotation.x = lerp(head.rotation.x, (style.headDown || 0) + (style.nod ? Math.sin(t * style.speed) * style.nod : 0), k);
  head.rotation.y = lerp(head.rotation.y, style.look ? Math.sin(t * 0.9) * style.look : 0, k);

  // Arms: pose, with waving on tap and cheering oscillation.
  const waving = state.waveUntil && state.t < state.waveUntil;
  const pose = POSES[state.microphone && style.pose === 'down' ? 'sing' : style.pose] || POSES.down;
  const r = waving ? [2.5, 0, 0.6 + Math.sin(state.t * 14) * 0.45, 0] : [...pose.r];
  const l = [...pose.l];
  if (style.pose === 'cheer') {
    r[0] += Math.sin(t * 7) * 0.25;
    l[0] += Math.sin(t * 7 + Math.PI) * 0.25;
  }
  driveArm(armR, r, 1, waving ? 0.35 : k);
  driveArm(armL, l, -1, k);
}
