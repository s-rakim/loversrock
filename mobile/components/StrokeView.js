// Renders shared-canvas strokes. Points are normalised 0..1 on a fixed 3:4
// canvas, so the same drawing looks identical on every phone. `viewport`
// ({ x, y, zoom }) lets the editor zoom/pan by changing the SVG viewBox.
import React from 'react';
import Svg, { Polyline, Circle, Rect } from 'react-native-svg';

export const CANVAS_W = 1000;
export const CANVAS_H = 1333;

export function StrokeShape({ stroke, background }) {
  const color = stroke.tool === 'eraser' ? background : stroke.color || '#E8607A';
  const width = (stroke.width || 0.008) * CANVAS_W;
  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    return <Circle cx={p.x * CANVAS_W} cy={p.y * CANVAS_H} r={width / 2} fill={color} />;
  }
  return (
    <Polyline
      points={stroke.points.map((p) => `${p.x * CANVAS_W},${p.y * CANVAS_H}`).join(' ')}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export default function StrokeView({ strokes = [], background = '#FFFFFF', width, height, viewport, extra }) {
  const zoom = viewport?.zoom || 1;
  const vb = `${(viewport?.x || 0) * CANVAS_W} ${(viewport?.y || 0) * CANVAS_H} ${CANVAS_W / zoom} ${CANVAS_H / zoom}`;
  return (
    <Svg width={width} height={height ?? (width * CANVAS_H) / CANVAS_W} viewBox={vb}>
      <Rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={background} />
      {strokes.map((s, i) => <StrokeShape key={i} stroke={s} background={background} />)}
      {extra ? <StrokeShape stroke={extra} background={background} /> : null}
    </Svg>
  );
}
