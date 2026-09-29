// The timelapse behind every screen: the two of you on the bench above the
// Golden Gate, from day through sunset, the stars and the full moon to dawn
// and back, on a loop (assets/sky/timelapse.mp4, made by build-sky.py).
//
// Silent, and it never holds the audio: it must not stop a song, a voice note
// or a call. Falls back to the live sky if video cannot play on this build.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from './ThemeContext';
import SkyBackground from './SkyBackground';

let Video = null;
let ResizeMode = null;
try {
  // eslint-disable-next-line global-require
  ({ Video, ResizeMode } = require('expo-av'));
} catch {
  Video = null;
}

const CLIP = require('../assets/sky/timelapse.mp4');

// For a preview: the scene at sunset, still, rather than a video per tile.
const SUNSET = new Date(2000, 0, 1, 18, 40);

export default function TimelapseBackground({ still = false }) {
  const { isDark } = useTheme();
  const [failed, setFailed] = useState(!Video);
  if (still) return <SkyBackground still at={SUNSET} veil={false} />;
  if (failed) return <SkyBackground />;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Video
        source={CLIP}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode?.COVER ?? 'cover'}
        shouldPlay
        isLooping
        isMuted
        onError={() => setFailed(true)}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(8,6,20,0.38)' : 'rgba(255,250,252,0.22)' }]} />
    </View>
  );
}
