// Hand-drawn vector "stickers" (heart / sparkle / flower / ribbon) used as a
// decorative background layer, plus a gentle floating-loop wrapper. These
// are original inline SVG shapes, not emoji glyphs or downloaded images —
// see components/Icon.js for the same reasoning applied to functional icons.
import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from './ThemeContext';

export function HeartShape({ size = 28, color }) {
  const { colors } = useTheme();
  color = color || colors.accentPink;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20.5C12 20.5 3 14.7 3 8.9C3 5.9 5.4 3.6 8.3 3.6C10 3.6 11.3 4.4 12 5.6C12.7 4.4 14 3.6 15.7 3.6C18.6 3.6 21 5.9 21 8.9C21 14.7 12 20.5 12 20.5Z"
        fill={color}
      />
    </Svg>
  );
}

export function SparkleShape({ size = 24, color }) {
  const { colors } = useTheme();
  color = color || colors.gold;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2L13.8 9.2L21 11L13.8 12.8L12 20L10.2 12.8L3 11L10.2 9.2L12 2Z"
        fill={color}
      />
    </Svg>
  );
}

export function FlowerShape({ size = 26, color }) {
  const { colors } = useTheme();
  color = color || colors.accentPink;
  const petals = [0, 72, 144, 216, 288];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {petals.map((deg) => (
        <Circle
          key={deg}
          cx={12 + 5 * Math.cos((deg * Math.PI) / 180)}
          cy={12 + 5 * Math.sin((deg * Math.PI) / 180)}
          r={4.5}
          fill={color}
          opacity={0.85}
        />
      ))}
      <Circle cx={12} cy={12} r={3} fill={colors.gold} />
    </Svg>
  );
}

export function RibbonShape({ size = 26, color }) {
  const { colors } = useTheme();
  color = color || colors.accentPink;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4L4 10L12 14L20 10L12 4Z" fill={color} />
      <Path d="M8 12L4 20L9 18L12 22L15 18L20 20L16 12L12 15L8 12Z" fill={color} opacity={0.7} />
    </Svg>
  );
}

const SHAPES = { heart: HeartShape, sparkle: SparkleShape, flower: FlowerShape, ribbon: RibbonShape };

// A single sticker that bobs and rotates gently in an endless loop.
export function FloatingSticker({ type = 'heart', size = 26, color, top, left, right, bottom, opacity = 0.5, duration = 3200 }) {
  const bob = useRef(new Animated.Value(0)).current;
  const Shape = SHAPES[type] || HeartShape;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [duration]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const rotate = bob.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floating,
        { top, left, right, bottom, opacity, transform: [{ translateY }, { rotate }] },
      ]}
    >
      <Shape size={size} color={color} />
    </Animated.View>
  );
}

// Scattered background layer of a handful of stickers. `variant` picks one
// of a few preset layouts so different screens don't feel identical.
const LAYOUTS = {
  home: [
    { type: 'heart', top: 8, right: 24, size: 22, duration: 2800 },
    { type: 'sparkle', top: 120, left: 12, size: 16, duration: 2200 },
    { type: 'flower', bottom: 140, right: 16, size: 20, duration: 3400 },
    { type: 'sparkle', bottom: 60, left: 30, size: 14, duration: 2600 },
  ],
  form: [
    { type: 'heart', top: 40, left: 20, size: 20, duration: 3000 },
    { type: 'sparkle', top: 90, right: 28, size: 16, duration: 2400 },
    { type: 'ribbon', bottom: 80, right: 24, size: 22, duration: 3600 },
  ],
  celebrate: [
    { type: 'sparkle', top: 20, left: 24, size: 18, duration: 2000 },
    { type: 'sparkle', top: 60, right: 20, size: 14, duration: 2400 },
    { type: 'heart', bottom: 100, left: 16, size: 20, duration: 3000 },
    { type: 'flower', bottom: 40, right: 30, size: 18, duration: 3200 },
  ],
  minimal: [
    { type: 'heart', top: 16, right: 20, size: 16, duration: 3000 },
    { type: 'sparkle', bottom: 30, left: 20, size: 14, duration: 2600 },
  ],
};

export default function StickerField({ variant = 'minimal' }) {
  const { colors } = useTheme();
  const layout = LAYOUTS[variant] || LAYOUTS.minimal;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {layout.map((sticker, i) => (
        <FloatingSticker key={i} {...sticker} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  floating: { position: 'absolute' },
});
