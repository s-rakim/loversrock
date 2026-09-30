// What sits behind every screen, as chosen in Settings → Appearance or the
// wallpaper picker: the lava lamp (default), the live skies and their
// timelapses, the colours and patterns, or one of your photos. It is the
// same renderer as the chat's wallpaper, so anything that works there works
// here.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useGlass } from './GlassContext';
import LavaLamp from './LavaLamp';
import Wallpaper, { WALLPAPERS_BY_ID, photoKeyOf } from './Wallpaper';

/** Whether this version can draw `value` behind the app. */
export function canDraw(value) {
  if (photoKeyOf(value)) return true;
  const preset = WALLPAPERS_BY_ID[value];
  return Boolean(preset && !preset.transparent);
}

export default function AppBackdrop() {
  const { backdrop } = useGlass();
  // The lava lamp is the default, and what an unknown id (a wallpaper from a
  // newer version) falls back to rather than a blank screen.
  if (backdrop === 'lava' || !canDraw(backdrop)) return <LavaLamp />;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Wallpaper value={backdrop} />
    </View>
  );
}
