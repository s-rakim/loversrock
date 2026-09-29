// What sits behind every screen, as chosen in Settings → Appearance:
// the lava lamp (default), the live sky, or its timelapse.
import React from 'react';
import { useGlass } from './GlassContext';
import SkyBackground from './SkyBackground';
import TimelapseBackground from './TimelapseBackground';
import LavaLamp from './LavaLamp';

export default function AppBackdrop() {
  const { backdrop } = useGlass();
  if (backdrop === 'sky') return <SkyBackground />;
  if (backdrop === 'timelapse') return <TimelapseBackground />;
  return <LavaLamp />;
}
