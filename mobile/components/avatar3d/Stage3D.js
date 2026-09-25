// Renders one or more live 3D characters into an expo-gl surface with
// three.js. Rigs are rebuilt only when a character's wardrobe changes; mood,
// taps and blinking are applied every frame by animate.js.
import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { GLView } from 'expo-gl';
import * as THREE from 'three';
import { buildCharacter } from './buildCharacter';
import { animateCharacter } from './animate';

const CHARACTER_HEIGHT = 2.3; // world units incl. hair, feet at 0
const FOV = 28;

// expo-gl hands us a bare GL context; three wants something canvas-shaped.
function makeRenderer(gl) {
  const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;
  const canvas = {
    width, height, clientWidth: width, clientHeight: height, style: {},
    addEventListener: () => {}, removeEventListener: () => {}, getContext: () => gl,
  };
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function lights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9c7c0, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe0e6, 0.8);
  rim.position.set(-2, 2, -2);
  scene.add(rim);
}

/**
 * characters: [{ avatar, emotion, x, pokeAt }]  (x in world units; ~0.42 apart for a couple)
 * width/height: px.  spanX: world-units width that must stay in frame.
 */
export default function Stage3D({ characters, width, height, spanX = 1.1, paused = false, onError }) {
  const props = useRef({ characters, paused });
  props.current = { characters, paused };
  const frame = useRef(null);
  const cleanup = useRef(null);

  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    cleanup.current?.();
  }, []);

  async function onContextCreate(gl) {
    try {
      const renderer = makeRenderer(gl);
      const scene = new THREE.Scene();
      lights(scene);

      // Fit the whole body vertically, and `spanX` horizontally.
      const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
      const tan = Math.tan(((FOV / 2) * Math.PI) / 180);
      const distance = Math.max(CHARACTER_HEIGHT / (2 * tan), spanX / (2 * tan * aspect)) * 1.04;
      const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 50);
      camera.position.set(0, CHARACTER_HEIGHT / 2, distance);
      camera.lookAt(0, CHARACTER_HEIGHT / 2 - 0.05, 0);

      const rigs = []; // { key, rig, pokeAt, waveUntil, spinStart, phase, nextBlink }
      const start = Date.now();
      let last = start;
      let appActive = AppState.currentState === 'active';
      const sub = AppState.addEventListener('change', (s) => { appActive = s === 'active'; });

      const loop = () => {
        frame.current = requestAnimationFrame(loop);
        if (!appActive || props.current.paused) return;
        try {
          step();
        } catch (err) {
          // A GPU/driver problem mid-flight: stop drawing and let the caller
          // swap in the 2D characters rather than crash the screen.
          cancelAnimationFrame(frame.current);
          onError?.(err);
        }
      };
      const step = () => {
        const now = Date.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        if (dt < 1 / 40) return; // ~30fps is plenty and saves battery
        last = now;
        const t = (now - start) / 1000;

        props.current.characters.forEach((c, i) => {
          const key = JSON.stringify(c.avatar || null);
          let entry = rigs[i];
          if (!entry || entry.key !== key) {
            if (entry) scene.remove(entry.rig.root);
            entry = { key, rig: buildCharacter(c.avatar), phase: i * 1.3, nextBlink: t + 1 + Math.random() * 3, pokeAt: c.pokeAt };
            scene.add(entry.rig.root);
            rigs[i] = entry;
          }
          entry.rig.root.position.x = c.x || 0;
          if (c.pokeAt && c.pokeAt !== entry.pokeAt) {
            entry.pokeAt = c.pokeAt;
            entry.waveUntil = t + 1.4;
            entry.spinStart = t;
          }
          if (t > entry.nextBlink + 0.14) entry.nextBlink = t + 2 + Math.random() * 3.5;
          const blink = t > entry.nextBlink ? 1 : 0;
          animateCharacter(entry.rig, {
            emotion: c.emotion, t, dt, blink, phase: entry.phase,
            waveUntil: entry.waveUntil, spinStart: entry.spinStart,
            microphone: (c.avatar?.accessories || []).includes('microphone'),
          });
        });
        while (rigs.length > props.current.characters.length) scene.remove(rigs.pop().rig.root);

        renderer.render(scene, camera);
        gl.endFrameEXP();
      };
      loop();
      cleanup.current = () => sub.remove();
    } catch (err) {
      onError?.(err);
    }
  }

  return <GLView style={{ width, height }} onContextCreate={onContextCreate} />;
}
