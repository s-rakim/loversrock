import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { colors, font, spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';

const { width } = Dimensions.get('window');
const FIELD_SIZE = Math.min(width - spacing.lg * 2, 380);
const BALL_RADIUS = 10;
const HOLE_RADIUS = 16;
const FRICTION = 0.94;
const TILT_FORCE = 0.6;
const UPDATE_INTERVAL_MS = 16;

function randomHole() {
  return {
    x: HOLE_RADIUS + Math.random() * (FIELD_SIZE - HOLE_RADIUS * 2),
    y: HOLE_RADIUS + Math.random() * (FIELD_SIZE - HOLE_RADIUS * 2),
  };
}

// Real tilt physics: expo-sensors Accelerometer drives velocity, which is
// integrated into position every frame with friction damping — not a
// canned animation.
export default function LoveGolfScreen() {
  const [hole, setHole] = useState(randomHole);
  const [strokes, setStrokes] = useState(0);
  const [holedOut, setHoledOut] = useState(false);
  const ball = useRef({ x: FIELD_SIZE / 2, y: FIELD_SIZE / 2, vx: 0, vy: 0 });
  const tilt = useRef({ x: 0, y: 0 });
  const [, forceRender] = useState(0);

  useEffect(() => {
    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);
    const sub = Accelerometer.addListener(({ x, y }) => {
      tilt.current = { x, y };
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (holedOut) return;
      const b = ball.current;
      b.vx = (b.vx + tilt.current.x * TILT_FORCE) * FRICTION;
      b.vy = (b.vy - tilt.current.y * TILT_FORCE) * FRICTION;
      b.x = Math.min(Math.max(b.x + b.vx, BALL_RADIUS), FIELD_SIZE - BALL_RADIUS);
      b.y = Math.min(Math.max(b.y + b.vy, BALL_RADIUS), FIELD_SIZE - BALL_RADIUS);

      if (Math.abs(b.vx) > 0.05 || Math.abs(b.vy) > 0.05) {
        setStrokes((s) => (Math.abs(b.vx) + Math.abs(b.vy) > 0.3 && s === 0 ? s + 1 : s));
      }

      const dist = Math.hypot(b.x - hole.x, b.y - hole.y);
      if (dist < HOLE_RADIUS) {
        setHoledOut(true);
      }

      forceRender((n) => n + 1);
    }, UPDATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hole, holedOut]);

  function nextHole() {
    ball.current = { x: FIELD_SIZE / 2, y: FIELD_SIZE / 2, vx: 0, vy: 0 };
    setHole(randomHole());
    setStrokes(0);
    setHoledOut(false);
  }

  const b = ball.current;

  return (
    <View style={styles.container}>
      <FadeInUp>
        <Text style={font.muted}>Tilt your phone to putt the ball into the hole</Text>
      </FadeInUp>

      <View style={styles.field}>
        <View style={[styles.hole, { left: hole.x - HOLE_RADIUS, top: hole.y - HOLE_RADIUS }]} />
        <View style={[styles.ball, { left: b.x - BALL_RADIUS, top: b.y - BALL_RADIUS }]} />
      </View>

      {holedOut && (
        <FadeInUp>
          <Text style={[font.h2, { color: colors.success, marginTop: spacing.md }]}>Holed out! ⛳</Text>
          <MorphButton onPress={nextHole} style={styles.nextButton}>
            <Text style={{ color: '#000', fontWeight: '700' }}>Next hole</Text>
          </MorphButton>
        </FadeInUp>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', padding: spacing.lg },
  field: {
    width: FIELD_SIZE, height: FIELD_SIZE, backgroundColor: '#123a1f', borderRadius: radius.lg,
    marginTop: spacing.lg, borderWidth: 2, borderColor: colors.border, overflow: 'hidden',
  },
  hole: { position: 'absolute', width: HOLE_RADIUS * 2, height: HOLE_RADIUS * 2, borderRadius: HOLE_RADIUS, backgroundColor: '#000' },
  ball: { position: 'absolute', width: BALL_RADIUS * 2, height: BALL_RADIUS * 2, borderRadius: BALL_RADIUS, backgroundColor: '#fff' },
  nextButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginTop: spacing.sm },
});
