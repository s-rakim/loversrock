// Which way is up, in screen coordinates.
//
// A lava lamp rises. The blobs here drifted along a fixed screen axis, which
// is right exactly while the phone is upright and wrong the moment it is not:
// turn the phone sideways and the "rising" lava travels across the screen.
//
// This reads the accelerometer and hands back the real-world up direction
// expressed the way a transform wants it, so the field can be oriented to
// gravity instead of to the device.
//
// ON THE SIGN. Device axes put +y toward the top of the screen; React Native
// layout puts +y downward, so the vertical component is negated on the way
// out. The platforms then disagree about the accelerometer itself: at rest,
// Android reports roughly +1g along the axis pointing at the sky, iOS reports
// -1g. One constant, named, so the fix is one line if a device says otherwise.
//
// ON THE COST. The sensor is polled slowly and the result is both smoothed
// and quantised: a raw stream at 60Hz would re-render the whole background on
// every sample, for a change too small to see. It only reports when the
// direction has actually moved.
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// Upright in portrait, both platforms should give UP = (0, -1): toward the
// top of the screen.
const G_SIGN = Platform.OS === 'ios' ? -1 : 1;

/** Screen-space up when the phone is held normally. */
export const UP_DEFAULT = { x: 0, y: -1 };

const INTERVAL_MS = 220;
// How far the direction has to move before it is worth a re-render. About
// three degrees — below that it is hand tremor, not a turn.
const THRESHOLD = 0.05;
// A slow follow, so setting the phone down does not snap the whole field.
const SMOOTHING = 0.18;

export default function useGravity(enabled = true) {
  const [up, setUp] = useState(UP_DEFAULT);
  const smoothed = useRef(UP_DEFAULT);
  const reported = useRef(UP_DEFAULT);

  useEffect(() => {
    if (!enabled) {
      // Back to a known direction rather than frozen wherever it happened to
      // be: someone who turned this off should get the plain vertical field.
      smoothed.current = UP_DEFAULT;
      reported.current = UP_DEFAULT;
      setUp(UP_DEFAULT);
      return undefined;
    }

    let subscription = null;
    let cancelled = false;

    // Required rather than imported so a build without the sensor - or a
    // device that simply has no accelerometer - falls back to vertical
    // instead of failing to start. Same rule as every other native module
    // this app touches.
    let Accelerometer = null;
    try {
      // eslint-disable-next-line global-require
      ({ Accelerometer } = require('expo-sensors'));
    } catch {
      return undefined;
    }
    if (!Accelerometer?.addListener) return undefined;

    try {
      Accelerometer.setUpdateInterval(INTERVAL_MS);
      subscription = Accelerometer.addListener(({ x, y }) => {
        if (cancelled) return;

        // Lying flat: gravity is almost entirely on z, so x and y are noise
        // and there is no meaningful "up" on the screen. Hold the last one
        // rather than letting the field spin on the table.
        const magnitude = Math.hypot(x, y);
        if (!Number.isFinite(magnitude) || magnitude < 0.15) return;

        const nextX = (x * G_SIGN) / magnitude;
        const nextY = -(y * G_SIGN) / magnitude;

        const s = smoothed.current;
        const blended = {
          x: s.x + (nextX - s.x) * SMOOTHING,
          y: s.y + (nextY - s.y) * SMOOTHING,
        };
        const length = Math.hypot(blended.x, blended.y) || 1;
        blended.x /= length;
        blended.y /= length;
        smoothed.current = blended;

        const moved = Math.hypot(blended.x - reported.current.x, blended.y - reported.current.y);
        if (moved < THRESHOLD) return;
        reported.current = blended;
        setUp(blended);
      });
    } catch {
      return undefined;
    }

    return () => {
      cancelled = true;
      subscription?.remove?.();
    };
  }, [enabled]);

  return up;
}
