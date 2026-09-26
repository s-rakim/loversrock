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
import useMascotOwners from './useMascotOwners';
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
function Eyes({ kind, colour, skin }) {
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
        {/* The lid is what turns an open eye into a tired or unimpressed one.
            It is painted in the BODY colour, over the top of the eye, so it
            reads as a heavy eyelid rather than a line drawn across a face. */}
        <Path d={`M${left - 7} ${lidY} h14`} stroke={skin} strokeWidth="9" strokeLinecap="round" />
        <Path d={`M${right - 7} ${lidY} h14`} stroke={skin} strokeWidth="9" strokeLinecap="round" />
        {/* and a thin dark lash line along its edge, or the lid vanishes into
            the body it is painted in. */}
        <Path d={`M${left - 5.5} ${lidY + 4} h11`} stroke={colour} strokeWidth="2" strokeLinecap="round" />
        <Path d={`M${right - 5.5} ${lidY + 4} h11`} stroke={colour} strokeWidth="2" strokeLinecap="round" />
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

/**
 * The drawn character, used until real artwork is wired up.
 *
 * The body is one path. Everything that makes it look like a solid object
 * rather than a coloured shape is lighting laid over that path, in the order
 * a real one would fall:
 *
 *   FORM SHADOW  the body gradient, lit from the upper left, darkening to the
 *                lower right. On its own this already reads as a sphere.
 *   CORE SHADOW  a darker band just INSIDE the lower-right edge, with the
 *                very rim left lighter. This is the counter-intuitive one and
 *                it is what separates a ball from a flat disc with a gradient.
 *   BOUNCE       light thrown back up off the floor onto the underside.
 *   SPECULAR     a small bright highlight where the light source reflects,
 *                plus a second weaker one, which reads as a glossy surface.
 *   CONTACT      a soft ellipse on the floor. Without it the thing hovers.
 *
 * Gradient ids are global to the SVG document, so they are namespaced per
 * instance — the loading screen draws two mascots at once and without this
 * the second would wear the first one's colour.
 */
function DrawnMascot({ expression, colors, uid }) {
  const body = expression.tone || colors.accent;
  const ink = '#2A2333';
  const BODY = 'M50 8 C58 24, 76 32, 76 54 C76 71, 64 82, 50 82 C36 82, 24 71, 24 54 C24 32, 42 24, 50 8 Z';

  return (
    // Taller than wide, with room under the feet for the floor shadow.
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={`${uid}-body`} cx="38%" cy="30%" r="78%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.5} />
          <Stop offset="46%" stopColor={body} stopOpacity={1} />
          <Stop offset="100%" stopColor={body} stopOpacity={1} />
        </RadialGradient>
        {/* Dark at the centre of the lower right, easing off before the very
            edge — that untouched rim is the point of it. */}
        <RadialGradient id={`${uid}-core`} cx="72%" cy="74%" r="56%">
          <Stop offset="0%" stopColor="#1A1024" stopOpacity={0.34} />
          <Stop offset="72%" stopColor="#1A1024" stopOpacity={0.1} />
          <Stop offset="100%" stopColor="#1A1024" stopOpacity={0} />
        </RadialGradient>
        {/* Light coming back UP off the floor, warm and weak. */}
        <RadialGradient id={`${uid}-bounce`} cx="50%" cy="98%" r="46%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.3} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${uid}-floor`} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#000000" stopOpacity={0.28} />
          <Stop offset="58%" stopColor="#000000" stopOpacity={0.1} />
          <Stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </RadialGradient>
      </Defs>

      {/* Grounded before anything else is drawn. */}
      <Ellipse cx="50" cy="88" rx="24" ry="6" fill={`url(#${uid}-floor)`} />

      {/* A flame-ish drop: round at the bottom, drawn to a point at the top.
          Reads as a little creature rather than a logo. */}
      <Path d={BODY} fill={`url(#${uid}-body)`} />
      <Path d={BODY} fill={`url(#${uid}-core)`} />
      <Path d={BODY} fill={`url(#${uid}-bounce)`} />

      {/* Specular: a large soft one and a small hard one. Two highlights of
          different sharpness is the whole trick to a glossy surface. */}
      <Ellipse cx="36" cy="30" rx="8" ry="11" fill="#FFFFFF" opacity={0.3}
        transform="rotate(-22 36 30)" />
      <Ellipse cx="33.5" cy="26" rx="2.6" ry="3.6" fill="#FFFFFF" opacity={0.65}
        transform="rotate(-22 33.5 26)" />

      <Eyes kind={expression.eyes} colour={ink} skin={body} />
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
/*
 * @param drawn     force the drawn face even when artwork exists. For a mood
 *                  PICKER, where each swatch has to look different: there is
 *                  only neutral art so far, so every mood falls back to the
 *                  same photograph, and eleven identical photos cannot tell
 *                  "tired" from "excited".
 */
export default function Mascot({ mood, size = 96, animated = true, style, drawn = false }) {
  const { colors, reduceMotion } = useTheme();
  useMascotOwners();
  const expression = EXPRESSIONS[mood] || EXPRESSIONS.neutral;
  const art = drawn ? null : artFor(mood);
  // Per-instance, because SVG gradient ids are document-global and the
  // loading screen draws two of these side by side.
  const uid = useRef(`m${Math.random().toString(36).slice(2, 8)}`).current;

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
      // overflow hidden: a photograph has its own intrinsic size, and without
      // a clip it can spill past the square it was given.
      style={[{ width: size, height: size, overflow: 'hidden', transform: [{ translateY }, { rotate }] }, style]}
    >
      {art
        ? <Image source={art} style={StyleSheet.absoluteFill} resizeMode="contain" />
        : <DrawnMascot expression={expression} colors={colors} uid={uid} />}
    </Animated.View>
  );
}
