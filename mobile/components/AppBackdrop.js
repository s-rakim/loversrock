// What sits behind every screen, as chosen in Settings → Appearance:
// the lava lamp (default), or the live sky over the Golden Gate or New York,
// each also as a timelapse.
import React from 'react';
import { useGlass } from './GlassContext';
import SkyBackground from './SkyBackground';
import TimelapseBackground from './TimelapseBackground';
import LavaLamp from './LavaLamp';

export default function AppBackdrop() {
  const { backdrop } = useGlass();
  if (backdrop === 'sky') return <SkyBackground scene="goldengate" />;
  if (backdrop === 'timelapse') return <TimelapseBackground scene="goldengate" />;
  if (backdrop === 'newyork') return <SkyBackground scene="newyork" />;
  if (backdrop === 'newyork-timelapse') return <TimelapseBackground scene="newyork" />;
  return <LavaLamp />;
}
