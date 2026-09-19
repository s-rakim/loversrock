// Love Golf — a race over six shared holes.
//
// The hole LAYOUT comes from the server and is identical on both phones,
// which is the part that has to be fair. The physics stay here, because the
// input is a 60Hz accelerometer stream the server never sees and streaming
// it would be both wasteful and still unverifiable. When you sink the ball
// the device reports how many strokes it took.
//
// So this is the one game in the app whose score is client-reported, and
// docs/GAMES.md says so plainly rather than implying otherwise.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import { useTheme } from '../../components/ThemeContext';
import { MorphButton } from '../../components/Motion';
import { useMatch } from '../../components/games/useMatch';
import MatchFrame from '../../components/games/MatchFrame';
import RaceHeader from '../../components/games/RaceHeader';

const FIELD = Math.min(Dimensions.get('window').width - spacing.lg * 2, 340);
const BALL_R = 9;
const CUP_R = 15;
const FRICTION = 0.94;
const TILT = 0.55;
// Below this the ball is treated as stopped, so a putt ends decisively
// rather than creeping for ever.
const REST_SPEED = 0.12;

export default function LoveGolfScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const m = useMatch('love-golf');
  const s = m.match?.state;

  const [strokes, setStrokes] = useState(0);
  const [holed, setHoled] = useState(false);
  const [ball, setBall] = useState({ x: FIELD / 2, y: FIELD - 40 });
  const velocity = useRef({ x: 0, y: 0 });
  const tilt = useRef({ x: 0, y: 0 });
  const moving = useRef(false);

  const hole = s?.hole;
  // The server sends normalised 0..1 coordinates so any screen size lays the
  // same hole out the same way.
  const toPx = (v) => v * FIELD;

  // Reset the ball whenever the hole changes.
  useEffect(() => {
    if (!hole) return;
    setBall({ x: toPx(hole.start.x), y: toPx(hole.start.y) });
    velocity.current = { x: 0, y: 0 };
    setStrokes(0);
    setHoled(false);
  }, [s?.holeNumber, hole]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(16);
    const sub = Accelerometer.addListener(({ x, y }) => { tilt.current = { x, y }; });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!hole || holed || s?.done) return undefined;
    const id = setInterval(() => {
      setBall((prev) => {
        const v = velocity.current;
        if (!moving.current) return prev;

        // Tilt accelerates; friction bleeds it off.
        v.x = (v.x + tilt.current.x * TILT) * FRICTION;
        v.y = (v.y - tilt.current.y * TILT) * FRICTION;

        let nx = prev.x + v.x;
        let ny = prev.y + v.y;

        // Walls.
        if (nx < BALL_R) { nx = BALL_R; v.x = -v.x * 0.5; }
        if (nx > FIELD - BALL_R) { nx = FIELD - BALL_R; v.x = -v.x * 0.5; }
        if (ny < BALL_R) { ny = BALL_R; v.y = -v.y * 0.5; }
        if (ny > FIELD - BALL_R) { ny = FIELD - BALL_R; v.y = -v.y * 0.5; }

        // Obstacles: bounce off whichever axis overlapped least, which is a
        // cheap approximation that behaves correctly for axis-aligned bars.
        for (const o of hole.obstacles) {
          const ox = toPx(o.x); const oy = toPx(o.y);
          const ow = toPx(o.w); const oh = toPx(o.h);
          if (nx + BALL_R > ox && nx - BALL_R < ox + ow && ny + BALL_R > oy && ny - BALL_R < oy + oh) {
            const overlapX = Math.min(nx + BALL_R - ox, ox + ow - (nx - BALL_R));
            const overlapY = Math.min(ny + BALL_R - oy, oy + oh - (ny - BALL_R));
            if (overlapX < overlapY) { nx = prev.x; v.x = -v.x * 0.6; }
            else { ny = prev.y; v.y = -v.y * 0.6; }
          }
        }

        const cupX = toPx(hole.hole.x);
        const cupY = toPx(hole.hole.y);
        if (Math.hypot(nx - cupX, ny - cupY) < CUP_R) {
          moving.current = false;
          velocity.current = { x: 0, y: 0 };
          setHoled(true);
          return { x: cupX, y: cupY };
        }

        if (Math.hypot(v.x, v.y) < REST_SPEED) {
          moving.current = false;
          velocity.current = { x: 0, y: 0 };
        }
        return { x: nx, y: ny };
      });
    }, 16);
    return () => clearInterval(id);
  }, [hole, holed, s?.done, s?.holeNumber]);

  function putt() {
    if (moving.current || holed) return;
    moving.current = true;
    // A small nudge in the tilt direction, so a putt always does something
    // even if the phone is nearly flat.
    velocity.current = { x: tilt.current.x * 4, y: -tilt.current.y * 4 };
    setStrokes((n) => n + 1);
  }

  const canPlay = m.match?.status === 'active' && !s?.done && !m.busy;

  return (
    <MatchFrame
      title="Love Golf"
      subtitle="Six holes, same course. Fewest strokes wins."
      {...m}
      onStart={m.start}
      onResign={m.resign}
    >
      {s && (
        <>
          <RaceHeader
            score={s.total}
            opponentScore={s.opponentTotal}
            progress={s.holeNumber}
            opponentProgress={s.opponentHole}
            total={s.holes}
            label="Hole"
            lowerIsBetter
            done={s.done}
            opponentDone={s.opponentDone}
          />

          {s.done ? (
            <View style={styles.card}>
              <Text style={[font.h2, { textAlign: 'center' }]}>
                Round finished — {s.total} strokes
              </Text>
              <Text style={[font.muted, { textAlign: 'center', marginTop: spacing.xs }]}>
                {s.opponentDone ? '' : 'Waiting for them to finish…'}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text style={font.h3}>Hole {s.holeNumber} · par {s.pars[s.holeNumber - 1]}</Text>
                <Text style={font.body}>{strokes} strokes</Text>
              </View>

              <View style={[styles.field, { width: FIELD, height: FIELD }]}>
                {hole?.obstacles.map((o, i) => (
                  <View
                    key={i}
                    style={[
                      styles.obstacle,
                      { left: toPx(o.x), top: toPx(o.y), width: toPx(o.w), height: toPx(o.h) },
                    ]}
                  />
                ))}
                {hole && (
                  <View
                    style={[
                      styles.cup,
                      { left: toPx(hole.hole.x) - CUP_R, top: toPx(hole.hole.y) - CUP_R },
                    ]}
                  />
                )}
                <View style={[styles.ball, { left: ball.x - BALL_R, top: ball.y - BALL_R }]} />
              </View>

              {holed ? (
                <MorphButton
                  onPress={() => m.play({ hole: s.holeNumber - 1, strokes })}
                  disabled={!canPlay}
                  style={styles.primary}
                >
                  <Ionicons name="flag" size={18} color="#fff" />
                  <Text style={styles.primaryText}>
                    Holed in {strokes} — next hole
                  </Text>
                </MorphButton>
              ) : (
                <MorphButton
                  onPress={putt}
                  disabled={!canPlay}
                  style={[styles.primary, !canPlay && styles.disabled]}
                >
                  <Text style={styles.primaryText}>Putt</Text>
                </MorphButton>
              )}

              <Text style={[font.muted, styles.hint]}>
                Tilt the phone to steer. Tap Putt to set it rolling.
              </Text>
            </>
          )}

          <View style={styles.card}>
            <Text style={font.h3}>Your card</Text>
            <View style={styles.cardRow}>
              {s.pars.map((par, i) => (
                <View key={i} style={styles.cardCell}>
                  <Text style={[font.muted, { fontSize: 10 }]}>{i + 1}</Text>
                  <Text style={font.body}>{s.strokes[i] ?? '–'}</Text>
                  <Text style={[font.muted, { fontSize: 9 }]}>par {par}</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      )}
    </MatchFrame>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: spacing.sm,
    },
    field: {
      alignSelf: 'center', backgroundColor: '#3FA372',
      borderRadius: radius.md, overflow: 'hidden',
      borderWidth: 2, borderColor: '#2E7A55',
    },
    obstacle: { position: 'absolute', backgroundColor: '#8B5A2B', borderRadius: 4 },
    cup: {
      position: 'absolute', width: CUP_R * 2, height: CUP_R * 2,
      borderRadius: CUP_R, backgroundColor: '#14141F',
      borderWidth: 2, borderColor: '#FFFFFF',
    },
    ball: {
      position: 'absolute', width: BALL_R * 2, height: BALL_R * 2,
      borderRadius: BALL_R, backgroundColor: '#FFFFFF',
      borderWidth: 1, borderColor: '#DDD',
    },
    primary: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
      paddingVertical: spacing.md, marginTop: spacing.md,
    },
    primaryText: { color: '#fff', fontWeight: '700' },
    disabled: { opacity: 0.4 },
    hint: { textAlign: 'center', marginTop: spacing.sm },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.md,
      marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    cardRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
    cardCell: { alignItems: 'center' },
  });
