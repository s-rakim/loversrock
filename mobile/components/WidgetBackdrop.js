// The widget background, drawn in the app exactly as the widgets draw it —
// the live preview on the Widget look screen. Follows components/widgetLook.js
// to the letter; see the notes there for what each look is.
import React from 'react';
import Svg, {
  Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path, G, Pattern, ClipPath,
} from 'react-native-svg';
import {
  AURORA_BAND, blendCorners, fmod, geometry, mix, stops, tint,
} from './widgetLook';

const BLEND_ROWS = 32;

function Stops({ list }) {
  const at = stops(list.length);
  return list.map((c, i) => <Stop key={i} offset={at[i]} stopColor={c} />);
}

function Content({ look, w, h, uid }) {
  const g = geometry(look, w, h);
  const palette = look.colors;
  const n = palette.length;

  if (look.kind === 'solid') return <Rect width={w} height={h} fill={palette[0]} />;

  if (look.kind === 'gradient') {
    if (look.gradient === 'radial') {
      return (
        <>
          <Defs>
            <RadialGradient id={`${uid}r`} cx={g.cx} cy={g.cy} r={g.radius} gradientUnits="userSpaceOnUse">
              <Stops list={n === 1 ? [palette[0], tint(palette[0])] : palette} />
            </RadialGradient>
          </Defs>
          <Rect width={w} height={h} fill={`url(#${uid}r)`} />
        </>
      );
    }
    if (look.gradient === 'blend') {
      // Row by row, each a left-to-right gradient between the colours its
      // two side edges have at that height: the four corners, mixed.
      const [tl, tr, bl, br] = blendCorners(palette);
      const rowH = h / BLEND_ROWS;
      return (
        <>
          <Defs>
            {Array.from({ length: BLEND_ROWS }, (_, r) => {
              const t = (r + 0.5) / BLEND_ROWS;
              return (
                <LinearGradient key={r} id={`${uid}b${r}`} x1={0} y1={0} x2={w} y2={0} gradientUnits="userSpaceOnUse">
                  <Stop offset={0} stopColor={mix(tl, bl, t)} />
                  <Stop offset={1} stopColor={mix(tr, br, t)} />
                </LinearGradient>
              );
            })}
          </Defs>
          {Array.from({ length: BLEND_ROWS }, (_, r) => (
            <Rect key={r} x={0} y={r * rowH} width={w} height={rowH + 0.6} fill={`url(#${uid}b${r})`} />
          ))}
        </>
      );
    }
    // linear, and aurora on top of it.
    const [x1, y1] = g.start;
    const [x2, y2] = g.end;
    const list = n === 1 ? [palette[0], tint(palette[0])] : palette;
    const band = AURORA_BAND;
    return (
      <>
        <Defs>
          <LinearGradient id={`${uid}l`} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
            <Stops list={list} />
          </LinearGradient>
          {look.gradient === 'aurora' && (
            <LinearGradient id={`${uid}a`} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
              <Stop offset={band.at - band.half} stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset={band.at} stopColor="#FFFFFF" stopOpacity={band.alpha} />
              <Stop offset={band.at + band.half} stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
          )}
        </Defs>
        <Rect width={w} height={h} fill={`url(#${uid}l)`} />
        {look.gradient === 'aurora' && <Rect width={w} height={h} fill={`url(#${uid}a)`} />}
      </>
    );
  }

  // Patterns: a turned frame about the centre, cells of size s from it.
  const s = g.cell;
  const turn = `rotate(${look.angle} ${g.cx} ${g.cy})`;
  const second = n === 1 ? [palette[0], tint(palette[0])] : palette;

  if (look.pattern === 'waves') {
    const K = Math.ceil(g.reach / s) + 1;
    const amp = 0.35 * s;
    const wave = 3 * s;
    const step = wave / 16;
    const paths = [];
    for (let k = -K; k <= K; k += 1) {
      let d = '';
      for (let x = -g.reach - wave; x <= g.reach + wave; x += step) {
        const y = k * s + amp * Math.sin((2 * Math.PI * x) / wave);
        d += `${d ? 'L' : 'M'}${(g.cx + x).toFixed(2)},${(g.cy + y).toFixed(2)}`;
      }
      d += `L${(g.cx + g.reach + wave).toFixed(2)},${(g.cy + g.reach + s).toFixed(2)}`;
      d += `L${(g.cx - g.reach - wave).toFixed(2)},${(g.cy + g.reach + s).toFixed(2)}Z`;
      paths.push(<Path key={k} d={d} fill={second[fmod(k, second.length)]} />);
    }
    return (
      <>
        <Rect width={w} height={h} fill={second[fmod(-K - 1, second.length)]} />
        <G transform={turn}>{paths}</G>
      </>
    );
  }

  // Stripes, checks and dots repeat, so they are one tile repeated by SVG —
  // anchored at the centre, so cell (0, 0) starts there, as on the widget.
  let tile;
  let size;
  if (look.pattern === 'stripes') {
    size = [s * second.length, s];
    tile = second.map((c, i) => <Rect key={i} x={i * s} y={0} width={s + 0.3} height={s} fill={c} />);
  } else if (look.pattern === 'checks') {
    const m = second.length;
    size = [s * m, s * m];
    tile = [];
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        tile.push(<Rect key={`${i}-${j}`} x={i * s} y={j * s} width={s + 0.3} height={s + 0.3} fill={second[(i + j) % m]} />);
      }
    }
  } else {
    const dotColors = n === 1 ? [tint(palette[0])] : palette.slice(1);
    const m = dotColors.length;
    size = [s * m, s * m];
    tile = [<Rect key="bg" width={s * m} height={s * m} fill={palette[0]} />];
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        tile.push(<Circle key={`${i}-${j}`} cx={(i + 0.5) * s} cy={(j + 0.5) * s} r={0.32 * s} fill={dotColors[(i + j) % m]} />);
      }
    }
  }
  return (
    <>
      <Defs>
        <Pattern
          id={`${uid}p`} patternUnits="userSpaceOnUse"
          x={g.cx} y={g.cy} width={size[0]} height={size[1]}
          patternTransform={turn}
        >
          {tile}
        </Pattern>
      </Defs>
      <Rect width={w} height={h} fill={`url(#${uid}p)`} />
    </>
  );
}

/**
 * @param look     a normalised look (widgetLook.normalizeLook)
 * @param opacity  percent opaque, 20–100
 */
export default function WidgetBackdrop({ look, opacity = 70, width, height, radius = 22, style }) {
  const uid = React.useRef(`wb${Math.random().toString(36).slice(2, 7)}`).current;
  const w = width;
  const h = height;
  const glass = look.kind === 'glass';
  const alpha = Math.max(0, Math.min(1, opacity / 100));
  return (
    <Svg width={w} height={h} style={style}>
      <Defs>
        <ClipPath id={`${uid}c`}>
          <Rect width={w} height={h} rx={radius} ry={radius} />
        </ClipPath>
        <LinearGradient id={`${uid}g`} x1={0} y1={0} x2={0} y2={h} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor="#E4E6EA" stopOpacity={Math.min(1, alpha + 0.03)} />
          <Stop offset={1} stopColor="#AEB2BA" stopOpacity={Math.max(0, alpha - 0.03)} />
        </LinearGradient>
        <LinearGradient id={`${uid}s`} x1={0} y1={0} x2={0} y2={h} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.45} />
          <Stop offset={0.45} stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <G clipPath={`url(#${uid}c)`}>
        {glass
          ? <Rect width={w} height={h} fill={`url(#${uid}g)`} />
          : <G opacity={alpha}><Content look={look} w={w} h={h} uid={uid} /></G>}
        <Rect width={w} height={h} fill={`url(#${uid}s)`} />
      </G>
      <Rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={radius} ry={radius}
        fill="none" stroke="#FFFFFF" strokeOpacity={0.7} strokeWidth={1} />
    </Svg>
  );
}
