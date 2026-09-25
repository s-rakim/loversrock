// The mascot.
//
// It wears your PARTNER'S mood, not yours. That is the whole idea and it is
// worth being explicit about, because the obvious implementation is the wrong
// one: a character that mirrors your own feelings is a mirror, and you
// already know how you feel. A character that carries theirs is a way of
// noticing them — you open the app and the little thing at the top is tired,
// so you ask.
//
// Two renderers behind one component. If assets/mascot/index.js has artwork
// wired up it is used; otherwise the character is DRAWN, so the app has a
// mascot today and a better one the moment the art exists. Nothing else in
// the app needs to know which it got.
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Image, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Ellipse, G, Defs, RadialGradient, Stop } from 'react-native-svg';
import { artFor } from '../assets/mascot';
import { useTheme } from './ThemeContext';

/**
 * How each mood looks.
 *
 * `tone` shifts the body colour, the rest shape the face. Kept as data rather
 * than ten branches of drawing code so a new mood is one row.
 */
export const EXPRESSIONS = {
  neutral: { tone: null, eyes: 'open', mouth: 'soft', bob: 1, accessory: null },
  happy: { tone: '#FFC24D', eyes: 'arc', mouth: 'smile', bob: 1.25, accessory: null },
  loved: { tone: '#FF7BA8', eyes: 'heart', mouth: 'smile', bob: 1.1, accessory: 'hearts' },
  calm: { tone: '#7FD1C1', eyes: 'closed', mouth: 'soft', bob: 0.6, accessory: null },
  tired: { tone: '#9B93C7', eyes: 'droopy', mouth: 'flat', bob: 0.45, accessory: 'sleep' },
  stressed: { tone: '#FF9B5C', eyes: 'wide', mouth: 'wavy', bob: 1.8, accessory: 'sweat' },
  sad: { tone: '#7FA6D9', eyes: 'droopy', mouth: 'frown', bob: 0.5, accessory: 'tear' },
  annoyed: { tone: '#E0705C', eyes: 'half', mouth: 'flat', bob: 0.8, accessory: null },
  excited: { tone: '#FFD447', eyes: 'star', mouth: 'open', bob: 2.2, accessory: 'sparks' },
  lonely: { tone: '#8E93B8', eyes: 'away', mouth: 'frown', bob: 0.4, accessory: null },
  unwell: { tone: '#9DBF7F', eyes: 'closed', mouth: 'wavy', bob: 0.4, accessory: 'sweat' },
};

export const MASCOT_MOODS = Object.keys(EXPRESSIONS).filter((m) => m !== 'neutral');

/** Eyes, as SVG, per expression. */
function Eyes({ kind, colour }) {
  const left = 38;
  const right = 62;
  const y = 46;

  if (kind === 'closed' || kind === 'arc') {
    // A closed eye and a happy eye are the same arc; only the direction of
    // the curve differs, which is most of what makes a face look pleased.
    const d = (cx) => (kind === 'arc'
      ? `M${cx - 7} ${y + 2} Q${cx} ${y - 6} ${cx + 7} ${y + 2}`
      : `M${cx - 7} ${y - 1} Q${cx} ${y + 5} ${cx + 7} ${y - 1}`);
    return (
      <G>
        <Path d={d(left)} stroke={colour} strokeWidth="3" fill="none" strokeLinecap="round" />
        <Path d={d(right)} stroke={colour} strokeWidth="3" fill="none" strokeLinecap="round" />
      </G>
    );
  }

  if (kind === 'heart') {
    const heart = (cx) =>
      `M${cx} ${y + 5} C${cx - 8} ${y - 3}, ${cx - 3} ${y - 9}, ${cx} ${y - 4} `
      + `C${cx + 3} ${y - 9}, ${cx + 8} ${y - 3}, ${cx} ${y + 5} Z`;
    return (
      <G>
        <Path d={heart(left)} fill={colour} />
        <Path d={heart(right)} fill={colour} />
      </G>
    );
  }

  if (kind === 'star') {
    const star = (cx) =>
      `M${cx} ${y - 8} L${cx + 2.5} ${y - 2} L${cx + 8} ${y - 1} L${cx + 3.5} ${y + 3} `
      + `L${cx + 5} ${y + 9} L${cx} ${y + 5.5} L${cx - 5} ${y + 9} L${cx - 3.5} ${y + 3} `
      + `L${cx - 8} ${y - 1} L${cx - 2.5} ${y - 2} Z`;
    return (
      <G>
        <Path d={star(left)} fill={colour} />
        <Path d={star(right)} fill={colour} />
      </G>
    );
  }

  if (kind === 'half' || kind === 'droopy') {
    const lidY = kind === 'half' ? y - 1 : y + 1;
    return (
      <G>
        <Circle cx={left} cy={y + 1} r="5" fill={colour} />
        <Circle cx={right} cy={y + 1} r="5" fill={colour} />
        {/* The lid is what turns an open eye into a tired or unimpressed
            one — drawn in the body colour so it reads as skin, not a line. */}
        <Path d={`M${left - 7} ${lidY} h14`} stroke={colour} strokeWidth="9"
          strokeLinecap="round" opacity={0} />
      </G>
    );
  }

  const r = kind === 'wide' ? 7 : 5.5;
  // "away" shifts both pupils to one side, which reads as not-quite-present.
  const shift = kind === 'away' ? -3 : 0;
  return (
    <G>
      <Circle cx={left} cy={y} r={r} fill={colour} />
      <Circle cx={right} cy={y} r={r} fill={colour} />
      {kind !== 'wide' && (
        <G>
          <Circle cx={left + 2 + shift} cy={y - 2} r="1.8" fill="#FFFFFF" />
          <Circle cx={right + 2 + shift} cy={y - 2} r="1.8" fill="#FFFFFF" />
        </G>
      )}
    </G>
  );
}

function Mouth({ kind, colour }) {
  const y = 62;
  const paths = {
    smile: `M42 ${y - 1} Q50 ${y + 8} 58 ${y - 1}`,
    soft: `M44 ${y + 1} Q50 ${y + 5} 56 ${y + 1}`,
    flat: `M44 ${y + 2} h12`,
    frown: `M42 ${y + 6} Q50 ${y - 2} 58 ${y + 6}`,
    wavy: `M42 ${y + 2} q4 -4 8 0 q4 4 8 0`,
  };
  if (kind === 'open') {
    return <Ellipse cx="50" cy={y + 2} rx="7" ry="6" fill={colour} />;
  }
  return (
    <Path d={paths[kind] || paths.soft} stroke={colour} strokeWidth="3"
      fill="none" strokeLinecap="round" strokeLinejoin="round" />
  );
}

function Accessory({ kind, colour }) {
  if (kind === 'hearts') {
    return (
      <G opacity={0.85}>
        <Path d="M78 26 C74 20, 69 24, 73 29 C75 31, 78 34, 78 34 C78 34, 81 31, 83 29 C87 24, 82 20, 78 26 Z" fill="#FF7BA8" />
        <Path d="M22 34 C19 30, 16 33, 19 36 C20 38, 22 40, 22 40 C22 40, 24 38, 25 36 C28 33, 25 30, 22 34 Z" fill="#FF7BA8" opacity={0.7} />
      </G>
    );
  }
  if (kind === 'sleep') {
    return (
      <G>
        <Path d="M76 24 h8 l-8 9 h8" stroke={colour} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <Path d="M87 14 h6 l-6 7 h6" stroke={colour} strokeWidth="2" fill="none" strokeLinecap="round" opacity={0.7} />
      </G>
    );
  }
  if (kind === 'sweat') {
    return <Path d="M74 32 c0 0 -4 6 -4 8.5 a4 4 0 0 0 8 0 c0 -2.5 -4 -8.5 -4 -8.5 Z" fill="#7FC7E8" />;
  }
  if (kind === 'tear') {
    return <Path d="M62 54 c0 0 -3 5 -3 7 a3 3 0 0 0 6 0 c0 -2 -3 -7 -3 -7 Z" fill="#7FC7E8" />;
  }
  if (kind === 'sparks') {
    return (
      <G fill="#FFD447">
        <Path d="M80 22 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" />
        <Path d="M20 30 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 Z" opacity={0.8} />
      </G>
    );
  }
  return null;
}

/** The drawn character, used until real artwork is wired up. */
function DrawnMascot({ expression, colors }) {
  const body = expression.tone || colors.accent;
  const ink = '#2A2333';

  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="mascotBody" cx="42%" cy="34%" r="72%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.45} />
          <Stop offset="55%" stopColor={body} stopOpacity={1} />
          <Stop offset="100%" stopColor={body} stopOpacity={1} />
        </RadialGradient>
      </Defs>

      {/* A flame-ish drop: round at the bottom, drawn to a point at the top.
          Reads as a little creature rather than a logo. */}
      <Path
        d="M50 8 C58 24, 76 32, 76 54 C76 71, 64 82, 50 82 C36 82, 24 71, 24 54 C24 32, 42 24, 50 8 Z"
        fill="url(#mascotBody)"
      />
      <Ellipse cx="34" cy="64" rx="6" ry="4" fill="#FFFFFF" opacity={0.22} />

      <Eyes kind={expression.eyes} colour={ink} />
      <Mouth kind={expression.mouth} colour={ink} />
      <Accessory kind={expression.accessory} colour={ink} />
    </Svg>
  );
}

/**
 * @param mood      the mood to WEAR — normally your partner's.
 * @param size      pixel size of the square it draws into.
 * @param animated  false pins it still (reduce motion, or a static header).
 */
export default function Mascot({ mood, size = 96, animated = true, style }) {
  const { colors, reduceMotion } = useTheme();
  const expression = EXPRESSIONS[mood] || EXPRESSIONS.neutral;
  const art = artFor(mood);

  const bob = useRef(new Animated.Value(0)).current;
  const moving = animated && !reduceMotion;

  useEffect(() => {
    if (!moving) {
      bob.stopAnimation();
      bob.setValue(0.5);
      return undefined;
    }
    // Speed carries as much of the feeling as the face does: excited bounces,
    // tired barely moves. One driver, period scaled by the expression.
    const period = 2600 / (expression.bob || 1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [moving, bob, expression.bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [3, -3] });
  const rotate = bob.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ width: size, height: size, transform: [{ translateY }, { rotate }] }, style]}
    >
      {art
        ? <Image source={art} style={StyleSheet.absoluteFill} resizeMode="contain" />
        : <DrawnMascot expression={expression} colors={colors} />}
    </Animated.View>
  );
}
