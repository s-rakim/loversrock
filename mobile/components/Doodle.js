// Doodle strokes: the format, the tools, and the renderer.
//
// One module, because the canvas, the message bubble and Draw Duel all have
// to agree on what a stroke is. They previously each drew their own
// hard-coded 4px accent-coloured polyline, which is why adding a second
// colour meant touching three files.
//
// STROKE FORMAT
//
//   { points: [{x, y}, …], color: '#RRGGBB', width: 6, tool: 'pen' }
//
// Older doodles are a bare array of points with no styling at all. Those
// still exist in the database and must keep rendering, so normalizeStroke()
// accepts either shape and fills in the old defaults. Nothing migrates the
// stored rows: a drawing someone sent is theirs, and rewriting it to add
// fields it never had would be changing their message.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

// A palette rather than a colour wheel: sixteen good colours you can hit
// with a thumb beat a continuous picker you cannot aim on a phone.
export const PALETTE = [
  '#111111', '#6B6B6B', '#FFFFFF', '#FF5C8D',
  '#E23B4E', '#FF8A00', '#E8C33C', '#4FC16B',
  '#1FBFA8', '#2F6FE0', '#4B1FD1', '#A163D8',
  '#F19EC2', '#8B5A2B', '#2B2B3A', '#7FC8A9',
];

export const CANVAS_COLORS = [
  { id: 'paper', label: 'Paper', value: '#FFFDF8' },
  { id: 'white', label: 'White', value: '#FFFFFF' },
  { id: 'blush', label: 'Blush', value: '#FDEAF0' },
  { id: 'mint', label: 'Mint', value: '#E8F7F0' },
  { id: 'sky', label: 'Sky', value: '#E8F0FD' },
  { id: 'night', label: 'Night', value: '#14141F' },
];

export const WIDTHS = [2, 4, 8, 14, 22];

/**
 * The tools.
 *
 * Every effect here is built from stroke width, opacity, dash pattern and
 * layering, because react-native-svg 15 has no filter primitives — there is
 * no Gaussian blur to make a real glow with. Stacking a wide translucent
 * pass under a narrow bright one is what stands in for it, and it reads
 * convincingly at the sizes a thumb draws at.
 */
export const TOOLS = [
  { id: 'pen', label: 'Pen', icon: 'create-outline' },
  { id: 'marker', label: 'Marker', icon: 'brush-outline' },
  { id: 'neon', label: 'Neon', icon: 'flashlight-outline' },
  { id: 'dashed', label: 'Dashed', icon: 'remove-outline' },
  { id: 'dotted', label: 'Dotted', icon: 'ellipsis-horizontal-outline' },
  { id: 'rainbow', label: 'Rainbow', icon: 'color-filter-outline' },
  { id: 'ribbon', label: 'Ribbon', icon: 'ribbon-outline' },
  { id: 'eraser', label: 'Eraser', icon: 'backspace-outline' },
];

export const DEFAULT_STROKE = { color: '#FF5C8D', width: 6, tool: 'pen' };

/** Accepts either stroke shape and always returns the new one. */
export function normalizeStroke(stroke) {
  if (Array.isArray(stroke)) {
    // Legacy: a bare point list, drawn the only way it ever could be.
    return { points: stroke, color: '#FF5C8D', width: 4, tool: 'pen' };
  }
  return {
    points: stroke?.points || [],
    color: stroke?.color || DEFAULT_STROKE.color,
    width: Number(stroke?.width) || DEFAULT_STROKE.width,
    tool: stroke?.tool || DEFAULT_STROKE.tool,
  };
}

const pointsAttr = (points) => points.map((p) => `${p.x},${p.y}`).join(' ');

/** One stroke, which for some tools means several overlaid polylines. */
export function StrokePath({ stroke, index, canvasColor = '#FFFDF8' }) {
  const { points, color, width, tool } = normalizeStroke(stroke);
  if (points.length === 0) return null;

  // A single tap is a dot, not a line — Polyline draws nothing for one point.
  if (points.length === 1) {
    if (tool === 'dotted' || tool === 'dashed') return null;
    return (
      <Circle
        cx={points[0].x}
        cy={points[0].y}
        r={Math.max(width, 2) / 2}
        fill={tool === 'eraser' ? canvasColor : color}
        opacity={tool === 'marker' ? 0.45 : 1}
      />
    );
  }

  const shared = {
    points: pointsAttr(points),
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  switch (tool) {
    case 'marker':
      // Translucent and wide, so crossing your own line darkens it the way
      // a real marker does.
      return <Polyline {...shared} stroke={color} strokeWidth={width * 2.2} opacity={0.4} />;

    case 'neon':
      // Three passes: a wide faint halo, a mid glow, then a near-white core.
      return (
        <React.Fragment>
          <Polyline {...shared} stroke={color} strokeWidth={width * 3.4} opacity={0.16} />
          <Polyline {...shared} stroke={color} strokeWidth={width * 1.9} opacity={0.38} />
          <Polyline {...shared} stroke={color} strokeWidth={width} opacity={1} />
          <Polyline {...shared} stroke="#FFFFFF" strokeWidth={Math.max(1, width * 0.34)} opacity={0.85} />
        </React.Fragment>
      );

    case 'dashed':
      return (
        <Polyline
          {...shared}
          stroke={color}
          strokeWidth={width}
          strokeDasharray={`${width * 2.4},${width * 1.8}`}
        />
      );

    case 'dotted':
      // Zero-length dashes with round caps render as actual dots.
      return (
        <Polyline
          {...shared}
          stroke={color}
          strokeWidth={width}
          strokeDasharray={`0.01,${width * 1.9}`}
        />
      );

    case 'rainbow': {
      // A gradient along the stroke's own bounding box, so the hue follows
      // the direction it was drawn in rather than the screen.
      const id = `rainbow-${index}`;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return (
        <React.Fragment>
          <Defs>
            <LinearGradient
              id={id}
              x1={Math.min(...xs)} y1={Math.min(...ys)}
              x2={Math.max(...xs)} y2={Math.max(...ys)}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor="#FF5C8D" />
              <Stop offset="0.25" stopColor="#FF8A00" />
              <Stop offset="0.5" stopColor="#E8C33C" />
              <Stop offset="0.75" stopColor="#4FC16B" />
              <Stop offset="1" stopColor="#4B1FD1" />
            </LinearGradient>
          </Defs>
          <Polyline {...shared} stroke={`url(#${id})`} strokeWidth={width} />
        </React.Fragment>
      );
    }

    case 'ribbon':
      // Square caps and a flat join give a calligraphic edge — the nearest
      // thing to a chisel nib without per-segment width.
      return (
        <Polyline
          {...shared}
          stroke={color}
          strokeWidth={width * 1.6}
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
      );

    case 'eraser':
      // Drawing in the canvas colour. Honest, and it keeps a stroke a stroke
      // — the alternative, deleting points from earlier strokes, could not
      // survive being replayed from stroke_data.
      return <Polyline {...shared} stroke={canvasColor} strokeWidth={width * 2.4} />;

    case 'pen':
    default:
      return <Polyline {...shared} stroke={color} strokeWidth={width} />;
  }
}

/**
 * A finished doodle, as shown in a message bubble.
 *
 * `canvasColor` travels with the doodle when there is one, so an eraser
 * stroke keeps erasing and a drawing made on a dark canvas is not rendered
 * on a light one.
 */
export default function Doodle({ strokeData, height = 180, style }) {
  const payload = Array.isArray(strokeData) ? { strokes: strokeData } : (strokeData || {});
  const strokes = payload.strokes || [];
  const canvasColor = payload.canvasColor || '#FFFDF8';

  return (
    <View style={[{ height, borderRadius: 12, overflow: 'hidden', backgroundColor: canvasColor }, style]}>
      <Svg style={StyleSheet.absoluteFill}>
        {strokes.map((stroke, i) => (
          <StrokePath key={i} stroke={stroke} index={i} canvasColor={canvasColor} />
        ))}
      </Svg>
    </View>
  );
}
