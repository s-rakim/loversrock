// The two of you, drawn.
//
// ON WHAT THIS IS AND IS NOT. The reference is a pair of 3D avatars of the
// two people who use this app. I cannot draw those — no amount of SVG makes a
// rendered 3D character — and pretending otherwise would ship something that
// looks like neither of you. So this is a flat, stylised character with the
// things that actually carry likeness made adjustable: skin tone, hair shape
// and colour, build, and a full wardrobe. Set it to a deep skin, locs and a
// blue football shirt and it reads as the person in the photo, in this app's
// own visual language rather than a bad copy of another one's.
//
// The wardrobe is the point. Clothes are drawn from data, so a new garment is
// a shape in one switch statement and a row in the server's catalogue — not
// an art commission.
//
// Expression comes from the partner's MOOD (see Mascot.js for why theirs and
// not yours), so the character is doing two jobs at once: it looks like them
// and it tells you how they are.
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Path, Circle, Ellipse, G, Rect, Defs, ClipPath } from 'react-native-svg';
import { useTheme } from './ThemeContext';
import { EXPRESSIONS } from './Mascot';

export const SKINS = {
  porcelain: '#F3D7C4', light: '#E8BE9C', medium: '#C98C63',
  tan: '#A96A44', deep: '#7A4A2B', rich: '#5A3520',
};
export const HAIR_COLORS = {
  black: '#1E1A1C', darkBrown: '#3B2A22', brown: '#6B4530', auburn: '#8C4A2F',
  blonde: '#C9995C', grey: '#9A9490', pink: '#E36FA0', blue: '#4C6FD1', green: '#3F8F6B',
};
export const GARMENT_COLORS = {
  black: '#22212B', white: '#F4F2F0', grey: '#8A8A96', navy: '#2C3A63',
  blue: '#3F63C6', sky: '#6FB3E0', teal: '#2F9E8F', green: '#3F8F5B',
  olive: '#6B7350', mustard: '#D2A33C', orange: '#E07A3C', red: '#C8453F',
  pink: '#E36FA0', lilac: '#9B7FD4', cream: '#EDE0C8', brown: '#6B4A33',
};

const shade = (hex, amount) => {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  const mix = (c) => Math.round(Math.max(0, Math.min(255, c + amount)));
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

/* ------------------------------------------------------------------ hair */
function Hair({ style, colour, skin }) {
  const dark = shade(colour, -18);
  switch (style) {
    case 'bald':
      return null;
    case 'fade':
      return <Path d="M31 30 Q50 14 69 30 Q69 22 50 18 Q31 22 31 30 Z" fill={colour} />;
    case 'afro':
      return (
        <G fill={colour}>
          <Circle cx="50" cy="26" r="24" />
          <Circle cx="33" cy="33" r="14" />
          <Circle cx="67" cy="33" r="14" />
        </G>
      );
    case 'locs':
      return (
        <G fill={colour}>
          <Path d="M30 32 Q50 12 70 32 Q70 20 50 16 Q30 20 30 32 Z" />
          {[-20, -12, -4, 4, 12, 20].map((dx, i) => (
            <Rect key={dx} x={50 + dx - 2.6} y={16 + Math.abs(dx) * 0.35} width="5.2"
              height={22 + (i % 2) * 8} rx="2.6" fill={i % 2 ? dark : colour} />
          ))}
        </G>
      );
    case 'curls':
      return (
        <G fill={colour}>
          {[[36, 22], [50, 17], [64, 22], [30, 32], [70, 32], [43, 18], [57, 18]].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" />
          ))}
        </G>
      );
    case 'long':
      return (
        <G fill={colour}>
          <Path d="M28 34 Q50 12 72 34 L72 62 Q66 52 64 34 L36 34 Q34 52 28 62 Z" />
        </G>
      );
    case 'ponytail':
      return (
        <G fill={colour}>
          <Path d="M30 32 Q50 13 70 32 Q70 21 50 17 Q30 21 30 32 Z" />
          <Path d="M68 30 Q80 38 76 56 Q72 44 66 38 Z" fill={dark} />
        </G>
      );
    case 'braids':
      return (
        <G fill={colour}>
          <Path d="M30 32 Q50 13 70 32 Q70 21 50 17 Q30 21 30 32 Z" />
          <Path d="M32 30 Q26 46 30 60" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" />
          <Path d="M68 30 Q74 46 70 60" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" />
        </G>
      );
    case 'bun':
      return (
        <G fill={colour}>
          <Circle cx="50" cy="12" r="8" />
          <Path d="M30 32 Q50 13 70 32 Q70 21 50 17 Q30 21 30 32 Z" />
        </G>
      );
    default: // short
      return <Path d="M30 33 Q50 12 70 33 Q70 20 50 16 Q30 20 30 33 Z" fill={colour} />;
  }
}

/* ------------------------------------------------------------ expression */
function Face({ mood, skin }) {
  const e = EXPRESSIONS[mood] || EXPRESSIONS.neutral;
  const ink = '#2A2333';
  const eyeY = 36;

  const eyes = () => {
    if (e.eyes === 'closed' || e.eyes === 'arc') {
      const d = (cx) => (e.eyes === 'arc'
        ? `M${cx - 4} ${eyeY + 1} Q${cx} ${eyeY - 4} ${cx + 4} ${eyeY + 1}`
        : `M${cx - 4} ${eyeY} Q${cx} ${eyeY + 3} ${cx + 4} ${eyeY}`);
      return (
        <G stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round">
          <Path d={d(43)} /><Path d={d(57)} />
        </G>
      );
    }
    if (e.eyes === 'heart') {
      const h = (cx) => `M${cx} ${eyeY + 3} C${cx - 5} ${eyeY - 2}, ${cx - 2} ${eyeY - 6}, ${cx} ${eyeY - 2} `
        + `C${cx + 2} ${eyeY - 6}, ${cx + 5} ${eyeY - 2}, ${cx} ${eyeY + 3} Z`;
      return <G fill="#E0456B"><Path d={h(43)} /><Path d={h(57)} /></G>;
    }
    const r = e.eyes === 'wide' ? 4 : 3;
    const dy = e.eyes === 'droopy' || e.eyes === 'half' ? 1 : 0;
    return (
      <G fill={ink}>
        <Circle cx="43" cy={eyeY + dy} r={r} />
        <Circle cx="57" cy={eyeY + dy} r={r} />
      </G>
    );
  };

  const mouths = {
    smile: `M44 ${44} Q50 ${50} 56 ${44}`,
    soft: `M45 ${45} Q50 ${48} 55 ${45}`,
    flat: `M45 ${46} h10`,
    frown: `M44 ${48} Q50 ${43} 56 ${48}`,
    wavy: `M44 ${46} q3 -3 6 0 q3 3 6 0`,
  };

  return (
    <G>
      {eyes()}
      {e.mouth === 'open'
        ? <Ellipse cx="50" cy="46" rx="5" ry="4" fill={ink} />
        : <Path d={mouths[e.mouth] || mouths.soft} stroke={ink} strokeWidth="2"
            fill="none" strokeLinecap="round" />}
    </G>
  );
}

/* --------------------------------------------------------------- clothes */
function Bottoms({ id, colour, skin }) {
  const dark = shade(colour, -22);
  if (id === 'skirt') {
    return <Path d="M36 84 L64 84 L70 104 L30 104 Z" fill={colour} />;
  }
  const legs = (topY, hemY) => (
    <G fill={colour}>
      <Rect x="37" y={topY} width="11" height={hemY - topY} rx="3" />
      <Rect x="52" y={topY} width="11" height={hemY - topY} rx="3" />
      <Rect x="36" y={topY} width="28" height="8" rx="3" fill={dark} />
    </G>
  );
  if (id === 'shorts') return legs(84, 100);
  if (id === 'cargo') {
    return (
      <G>
        {legs(84, 104)}
        {/* The pockets are what make them cargo rather than shorts. */}
        <Rect x="34.5" y="92" width="6" height="8" rx="1.5" fill={dark} />
        <Rect x="59.5" y="92" width="6" height="8" rx="1.5" fill={dark} />
      </G>
    );
  }
  if (id === 'joggers') {
    return (
      <G>
        {legs(84, 122)}
        <Rect x="37" y="118" width="11" height="5" rx="2.5" fill={dark} />
        <Rect x="52" y="118" width="11" height="5" rx="2.5" fill={dark} />
      </G>
    );
  }
  return legs(84, 124);   // jeans, trousers
}

function Top({ id, colour, accent, skin }) {
  const dark = shade(colour, -20);
  const body = (extra = null, sleeveY = 78) => (
    <G>
      <Path d="M38 56 Q50 52 62 56 L66 60 L66 88 L34 88 L34 60 Z" fill={colour} />
      {/* Sleeves drawn as rounded caps rather than rectangles: at this size a
          square shoulder reads as a box, not a person. */}
      <Ellipse cx="33" cy={sleeveY - 12} rx="6" ry="12" fill={colour} />
      <Ellipse cx="67" cy={sleeveY - 12} rx="6" ry="12" fill={colour} />
      {extra}
    </G>
  );

  if (id === 'dress') {
    return (
      <G>
        <Path d="M38 56 Q50 52 62 56 L68 62 L74 104 L26 104 L32 62 Z" fill={colour} />
        <Ellipse cx="33" cy="66" rx="5" ry="10" fill={colour} />
        <Ellipse cx="67" cy="66" rx="5" ry="10" fill={colour} />
      </G>
    );
  }
  if (id === 'tank') {
    return (
      <G>
        <Path d="M41 56 Q50 53 59 56 L64 62 L64 88 L36 88 L36 62 Z" fill={colour} />
      </G>
    );
  }
  if (id === 'hoodie') {
    return body(
      <G>
        <Path d="M41 54 Q50 62 59 54 L59 58 Q50 66 41 58 Z" fill={dark} />
        <Path d="M44 74 h12 v8 h-12 Z" fill={dark} opacity={0.5} />
      </G>
    );
  }
  if (id === 'jersey') {
    const stripe = accent ? GARMENT_COLORS[accent] || dark : dark;
    return body(
      <G>
        <Path d="M42 55 L50 62 L58 55 L58 60 L50 67 L42 60 Z" fill="#F4F2F0" />
        <Rect x="46" y="68" width="8" height="10" rx="2" fill={stripe} />
      </G>
    );
  }
  if (id === 'shirt') {
    return body(
      <G>
        <Path d="M50 56 L50 88" stroke={dark} strokeWidth="1.5" />
        <Path d="M44 55 L50 62 L56 55" stroke={dark} strokeWidth="2" fill="none" />
      </G>
    );
  }
  if (id === 'longSleeve' || id === 'jumper') {
    return (
      <G>
        <Path d="M38 56 Q50 52 62 56 L66 60 L66 88 L34 88 L34 60 Z" fill={colour} />
        <Ellipse cx="32" cy="74" rx="6" ry="19" fill={colour} />
        <Ellipse cx="68" cy="74" rx="6" ry="19" fill={colour} />
        {id === 'jumper' && <Rect x="34" y="84" width="32" height="5" rx="2" fill={dark} />}
      </G>
    );
  }
  return body();   // tee
}

function Shoes({ id, colour }) {
  if (id === 'barefoot') return null;
  const dark = shade(colour, -30);
  if (id === 'slides') {
    return (
      <G>
        <Rect x="35" y="124" width="14" height="5" rx="2.5" fill={colour} />
        <Rect x="51" y="124" width="14" height="5" rx="2.5" fill={colour} />
        <Rect x="37" y="122" width="10" height="3" rx="1.5" fill={dark} />
        <Rect x="53" y="122" width="10" height="3" rx="1.5" fill={dark} />
      </G>
    );
  }
  if (id === 'boots') {
    return (
      <G fill={colour}>
        <Rect x="35" y="116" width="14" height="13" rx="3" />
        <Rect x="51" y="116" width="14" height="13" rx="3" />
        <Rect x="34" y="126" width="16" height="4" rx="2" fill={dark} />
        <Rect x="50" y="126" width="16" height="4" rx="2" fill={dark} />
      </G>
    );
  }
  return (
    <G>
      <Path d="M35 122 h14 v6 a3 3 0 0 1 -3 3 h-8 a3 3 0 0 1 -3 -3 Z" fill={colour} />
      <Path d="M51 122 h14 v6 a3 3 0 0 1 -3 3 h-8 a3 3 0 0 1 -3 -3 Z" fill={colour} />
      <Rect x="34" y="128" width="16" height="3.5" rx="1.75" fill={dark} />
      <Rect x="50" y="128" width="16" height="3.5" rx="1.75" fill={dark} />
    </G>
  );
}

function Accessory({ id, colour }) {
  const c = GARMENT_COLORS[colour] || '#22212B';
  if (id === 'glasses') {
    return (
      <G stroke="#2A2333" strokeWidth="1.8" fill="none">
        <Circle cx="43" cy="36" r="6" /><Circle cx="57" cy="36" r="6" />
        <Path d="M49 36 h2" />
      </G>
    );
  }
  if (id === 'earrings') {
    return <G fill="#D2A33C"><Circle cx="31" cy="40" r="2.4" /><Circle cx="69" cy="40" r="2.4" /></G>;
  }
  if (id === 'cap') {
    return (
      <G fill={c}>
        <Path d="M31 28 Q50 12 69 28 L69 31 L31 31 Z" />
        <Path d="M69 29 q10 1 11 5 l-11 0 Z" />
      </G>
    );
  }
  if (id === 'beanie') {
    return (
      <G fill={c}>
        <Path d="M30 30 Q50 10 70 30 Z" />
        <Rect x="29" y="28" width="42" height="6" rx="3" fill={shade(c, -25)} />
      </G>
    );
  }
  if (id === 'chain') {
    return <Path d="M43 57 Q50 66 57 57" stroke="#D2A33C" strokeWidth="2" fill="none" />;
  }
  if (id === 'headphones') {
    return (
      <G fill={c}>
        <Path d="M30 34 Q50 12 70 34" stroke={c} strokeWidth="4" fill="none" />
        <Rect x="26" y="32" width="8" height="12" rx="4" />
        <Rect x="66" y="32" width="8" height="12" rx="4" />
      </G>
    );
  }
  return null;
}

/**
 * @param avatar {skin, hair, hairColor, build, outfit}
 * @param mood   the expression to wear — normally the owner's current mood.
 */
export default function Character({ avatar, mood, size = 120, animated = true, style }) {
  const { reduceMotion } = useTheme();
  const a = avatar || {};
  const skin = SKINS[a.skin] || SKINS.medium;
  const hairColour = HAIR_COLORS[a.hairColor] || HAIR_COLORS.black;
  const outfit = a.outfit || {};
  const expression = EXPRESSIONS[mood] || EXPRESSIONS.neutral;

  const width = a.build === 'broad' ? 1.1 : a.build === 'slim' ? 0.92 : 1;

  const bob = useRef(new Animated.Value(0)).current;
  const moving = animated && !reduceMotion;

  useEffect(() => {
    if (!moving) { bob.stopAnimation(); bob.setValue(0.5); return undefined; }
    const period = 2600 / (expression.bob || 1);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: period, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [moving, bob, expression.bob]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [2, -2] });

  const topId = outfit.top?.id || 'tee';
  // A dress covers the bottom slot; drawing trousers under it looks like a
  // mistake rather than a choice.
  const coversBottom = topId === 'dress';

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ width: size, height: size * 1.4, transform: [{ translateY }] }, style]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 140">
        <G transform={`translate(${50 - 50 * width} 0) scale(${width} 1)`}>
          {/* legs and arms in skin, so a short sleeve or shorts shows limb */}
          <G fill={skin}>
            <Rect x="38" y="84" width="9" height="42" rx="4.5" />
            <Rect x="53" y="84" width="9" height="42" rx="4.5" />
            <Rect x="29" y="60" width="7" height="32" rx="3.5" />
            <Rect x="64" y="60" width="7" height="32" rx="3.5" />
          </G>

          {!coversBottom && (
            <Bottoms id={outfit.bottom?.id || 'jeans'}
              colour={GARMENT_COLORS[outfit.bottom?.color] || GARMENT_COLORS.navy} skin={skin} />
          )}
          <Shoes id={outfit.shoes?.id || 'sneakers'}
            colour={GARMENT_COLORS[outfit.shoes?.color] || GARMENT_COLORS.white} />
          <Top id={topId}
            colour={GARMENT_COLORS[outfit.top?.color] || GARMENT_COLORS.white}
            accent={outfit.top?.accent} skin={skin} />

          {/* neck, then head over the collar */}
          <Rect x="46" y="48" width="8" height="10" fill={shade(skin, -14)} />
          <Ellipse cx="50" cy="36" rx="20" ry="22" fill={skin} />
          <Hair style={a.hair || 'short'} colour={hairColour} skin={skin} />
          <Face mood={mood} skin={skin} />
          <Accessory id={outfit.accessory?.id || 'none'} colour={outfit.accessory?.color} />
        </G>
      </Svg>
    </Animated.View>
  );
}
