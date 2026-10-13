// The couple mascot: your own image of the two of you, used exactly as it is.
//
// assets/mascot/original.png is the untouched original. assets/mascot/couple.png
// is the same pixels with only the background made transparent (every visible
// pixel is identical to the original). Nothing is redrawn or recoloured.
//
// "Live" comes from motion around the image — breathing, a slow 3D sway,
// a hop when tapped — and each person's mood appears above their own head as
// a bubble plus a little effect (hearts, sparkles, z's, a tear…). On your
// phone the mascot's energy follows your partner's mood; on theirs, yours.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { HeartShape } from './Stickers';
import { MASCOT_ASPECT, useMascotSize } from './mascotSizing';
import { colors } from '../theme';

const COUPLE = require('../assets/mascot/couple.png');

// Where each person is in the image (fractions of width/height). "her" is on
// the left, "him" on the right. `head` is the top of their hair: mood bubbles
// sit just above it so they never cover either of you. SPLIT is where a tap
// switches from one person to the other.
const PEOPLE = {
  her: { head: { x: 0.3, y: 0.055 } },
  him: { head: { x: 0.6, y: 0.015 } },
};
const SPLIT = 0.46;

// Motion for the whole image, per mood. Gentle on purpose: the image is
// never distorted, only moved.
const MOTION = {
  neutral: { bob: 3, period: 2000, sway: 5 },
  happy: { bob: 6, period: 1000, sway: 6, particles: 'notes' },
  love: { bob: 4, period: 1300, sway: 5, particles: 'hearts', beat: true },
  excited: { bob: 9, period: 560, sway: 8, particles: 'sparkles' },
  calm: { bob: 2, period: 3200, sway: 4 },
  missing: { bob: 2, period: 2400, sway: 7, particles: 'hearts' },
  sleepy: { bob: 2, period: 3400, sway: 3, particles: 'z' },
  sad: { bob: 1, period: 2800, sway: 3, particles: 'tear' },
  angry: { bob: 1, period: 900, sway: 2, shake: true },
  anxious: { bob: 1, period: 700, sway: 2, jitter: true },
  sick: { bob: 1, period: 3000, sway: 3 },
};

const BADGE = {
  neutral: '💭', happy: '😊', love: '🥰', excited: '🤩', calm: '😌', missing: '🥺',
  sleepy: '😴', sad: '😢', angry: '😤', anxious: '😰', sick: '🤒',
};

export const EMOTION_LABELS = {
  neutral: 'okay', happy: 'happy', love: 'loved up', excited: 'excited', calm: 'calm', missing: 'missing you',
  sleepy: 'sleepy', sad: 'sad', angry: 'grumpy', anxious: 'stressed', sick: 'unwell',
};

const sideOf = (person) => (person?.avatar?.preset === 'her' ? 'her' : 'him');

function Particles({ kind, x, y, width }) {
  const items = useRef(Array.from({ length: 3 }, (_, i) => ({ v: new Animated.Value(0), delay: i * 750, dx: (i - 1) * width * 0.07 }))).current;
  useEffect(() => {
    if (!kind) return undefined;
    const anim = Animated.parallel(items.map(({ v, delay }) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]))
    ));
    anim.start();
    return () => anim.stop();
  }, [kind]);
  if (!kind) return null;
  const glyph = { notes: '♪', sparkles: '✦', z: 'z', tear: '💧' }[kind];
  return items.map(({ v, dx }, i) => {
    const up = kind !== 'tear';
    return (
      <Animated.View
        key={i}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: x + dx - 8,
          top: up ? y : y + width * 0.12,
          opacity: v.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, up ? -width * 0.14 : width * 0.08] }) }],
        }}
      >
        {kind === 'hearts' ? <HeartShape size={14} /> : (
          <Text style={{ fontSize: 15, fontWeight: '800', color: kind === 'z' ? colors.textMuted : kind === 'sparkles' ? colors.gold : colors.accent }}>{glyph}</Text>
        )}
      </Animated.View>
    );
  });
}

const bubbleMetrics = (size, label) => {
  const fontSize = Math.max(14, size * 0.07);
  const width = Math.max(fontSize * 1.9, label ? 58 : 0);
  const height = fontSize * 1.3 + 8 + (label ? 13 : 0);
  return { fontSize, width, height };
};

// A mood bubble that pops whenever the mood changes. Its bottom edge rests
// just above the person's hair.
function MoodBubble({ emotion, emoji, x, y, size, label }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }).start();
  }, [emotion, emoji]);
  const { fontSize, width, height } = bubbleMetrics(size, label);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.bubble, {
        left: x - width / 2, top: y - height - 4, width, height,
        transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
      }]}
    >
      <Text style={{ fontSize }}>{emoji || BADGE[emotion] || BADGE.neutral}</Text>
      {label ? <Text style={styles.bubbleLabel} numberOfLines={1}>{label}</Text> : null}
    </Animated.View>
  );
}

/**
 * The animated couple image.
 *   height   — px (width follows the image)
 *   motionEmotion — mood driving the overall motion
 *   people   — { her: { emotion, emoji, label }, him: {...} } bubbles to show (either may be omitted)
 *   onPressSide(side) / onLongPressSide(side)
 */
function LiveCouple({ height, motionEmotion = 'neutral', people = {}, onPressSide, onLongPressSide }) {
  const width = height * MASCOT_ASPECT;
  const motion = MOTION[motionEmotion] || MOTION.neutral;
  const bob = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: motion.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: motion.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [motionEmotion]);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: motion.beat ? 550 : 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: motion.beat ? 550 : 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [motionEmotion]);

  // Slow turn left and right in perspective, so the image feels 3D.
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: -1, duration: 8400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(sway, { toValue: 0, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    shake.setValue(0);
    if (!motion.shake && !motion.jitter) return undefined;
    const loop = Animated.loop(Animated.timing(shake, { toValue: 1, duration: motion.shake ? 1200 : 320, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [motionEmotion]);

  const moodKey = JSON.stringify(people);
  useEffect(() => {
    entrance.setValue(0);
    Animated.spring(entrance, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }).start();
  }, [moodKey]);

  function tap(evt) {
    hop.setValue(0);
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: 260, easing: Easing.bounce, useNativeDriver: true }),
    ]).start();
    onPressSide?.(evt.nativeEvent.locationX / width < SPLIT ? 'her' : 'him');
  }

  const translateY = Animated.add(
    bob.interpolate({ inputRange: [0, 1], outputRange: [0, -motion.bob] }),
    hop.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.06] })
  );
  const translateX = motion.shake
    ? shake.interpolate({ inputRange: [0, 0.05, 0.1, 0.15, 0.2, 1], outputRange: [0, -3, 3, -3, 0, 0] })
    : motion.jitter ? shake.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 1, -1, 0.6, 0] }) : 0;
  const rotateY = sway.interpolate({ inputRange: [-1, 1], outputRange: [`-${motion.sway}deg`, `${motion.sway}deg`] });
  const scale = Animated.multiply(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [1, motion.beat ? 1.025 : 1.012] }),
    entrance.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] })
  );

  const headroom = bubbleMetrics(height, Object.values(people).some((p) => p?.label)).height + 8;
  return (
    <View style={{ width, height: height + headroom }}>
      <View style={{ height: headroom }} />
      <Pressable
        onPress={tap}
        onLongPress={(evt) => onLongPressSide?.(evt.nativeEvent.locationX / width < SPLIT ? 'her' : 'him')}
        delayLongPress={350}
      >
        <Animated.View
          style={{
            width, height, transformOrigin: 'bottom',
            transform: [{ perspective: 800 }, { translateX }, { translateY }, { rotateY }, { scale }],
          }}
        >
          <Image source={COUPLE} style={{ width, height }} resizeMode="contain" accessibilityLabel="The two of you" />
        </Animated.View>
      </Pressable>
      {Object.entries(people).map(([side, p]) => p && (
        <React.Fragment key={side}>
          <Particles kind={(MOTION[p.emotion] || MOTION.neutral).particles} x={PEOPLE[side].head.x * width} y={headroom + PEOPLE[side].head.y * height} width={width} />
          <MoodBubble emotion={p.emotion} emoji={p.emoji} label={p.label} x={PEOPLE[side].head.x * width} y={headroom + PEOPLE[side].head.y * height} size={height} />
        </React.Fragment>
      ))}
    </View>
  );
}

/**
 * The mascot focused on one person (profiles, mood picker, onboarding).
 * Always the whole couple image — only that person's mood bubble is shown.
 */
export default function Mascot({ avatar, emotion = 'neutral', emoji, size, context = 'hero', label, sublabel, onPress, onLongPress, style, side: forcedSide, bubbleLabel }) {
  const responsive = useMascotSize(context);
  const side = forcedSide || sideOf({ avatar });
  return (
    <View style={[{ alignItems: 'center' }, style]}>
      <LiveCouple
        height={size || responsive}
        motionEmotion={emotion}
        people={{ [side]: { emotion, emoji, label: bubbleLabel } }}
        onPressSide={() => onPress?.()}
        onLongPressSide={() => onLongPress?.()}
      />
      {label ? <Text style={styles.label} numberOfLines={1}>{label}</Text> : null}
      {sublabel ? <Text style={styles.sublabel} numberOfLines={1}>{sublabel}</Text> : null}
    </View>
  );
}

/**
 * Both of you, each with your own mood bubble. The overall motion follows the
 * partner's mood, so on your phone the mascot reacts to how they feel.
 */
export function CoupleMascots({ me, partner, size, context = 'home', onPressPartner, onPressMe, onLongPressMe, showLabels = true }) {
  const responsive = useMascotSize(context);
  const mySide = sideOf(me);
  const theirSide = mySide === 'her' ? 'him' : 'her';
  const people = {
    [theirSide]: { emotion: partner?.emotion || 'neutral', emoji: partner?.emoji || undefined, label: showLabels ? partner?.name : null },
    [mySide]: { emotion: me?.emotion || 'neutral', emoji: me?.emoji || undefined, label: showLabels ? 'You' : null },
  };
  return (
    <View style={{ alignItems: 'center' }}>
      <LiveCouple
        height={size || responsive}
        motionEmotion={partner?.emotion || me?.emotion || 'neutral'}
        people={people}
        onPressSide={(side) => (side === mySide ? onPressMe?.() : onPressPartner?.())}
        onLongPressSide={(side) => { if (side === mySide) onLongPressMe?.(); }}
      />
      {showLabels && partner?.moodText ? <Text style={styles.sublabel} numberOfLines={1}>{partner.name}: {partner.moodText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 999,
    paddingHorizontal: 6, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  bubbleLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, maxWidth: 70 },
  label: { marginTop: 4, fontSize: 14, fontWeight: '700', color: colors.text },
  sublabel: { marginTop: 2, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
});
