// Draws one character from an avatar config (see wardrobe.js). Pure SVG, no
// images, so every garment is recolourable and swappable. Layer order:
// back hair → legs/bottoms → shoes → torso/top → arms → neck/head → face →
// front hair → head accessories. viewBox is 120 × 220.
import React from 'react';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { normalizeAvatar } from './wardrobe';

const INK = '#1B120D';

function shade(hex, amt) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// Arm angles in degrees from straight down; positive = away from the body.
// Two-frame poses (wave, cheer) alternate on `frame`.
const POSES = {
  down: [[10, 10]],
  wave: [[10, 150], [10, 170]],
  cheer: [[155, 170], [170, 155]],
  heart: [[-35, -35]],
  hips: [['bent', 'bent']],
  hug: [[80, 80]],
  droop: [[4, 4]],
};

function armEnd(shoulder, angleDeg, side, len = 44) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: shoulder.x + Math.sin(a) * len * side, y: shoulder.y + Math.cos(a) * len };
}

function Arm({ shoulder, angle, side, sleeve, sleeveColor, skin, cuff, bent }) {
  if (bent) {
    // Hands on hips: elbow out to the side, hand back in on the waist.
    const elbow = { x: shoulder.x + 13 * side, y: shoulder.y + 18 };
    const hand = { x: shoulder.x + 1 * side, y: shoulder.y + 36 };
    return (
      <G>
        <Path d={`M${shoulder.x} ${shoulder.y} L${elbow.x} ${elbow.y} L${hand.x} ${hand.y}`} stroke={skin} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {sleeve > 0 && <Line x1={shoulder.x} y1={shoulder.y} x2={shoulder.x + 13 * side * Math.min(1, sleeve * 2)} y2={shoulder.y + 18 * Math.min(1, sleeve * 2)} stroke={sleeveColor} strokeWidth={11} strokeLinecap="round" />}
        <Circle cx={hand.x} cy={hand.y} r={5.5} fill={skin} />
      </G>
    );
  }
  const end = armEnd(shoulder, angle, side);
  const s = { x: shoulder.x + (end.x - shoulder.x) * sleeve, y: shoulder.y + (end.y - shoulder.y) * sleeve };
  return (
    <G>
      {sleeve < 1 && <Line x1={s.x} y1={s.y} x2={end.x} y2={end.y} stroke={skin} strokeWidth={8} strokeLinecap="round" />}
      {sleeve > 0 && <Line x1={shoulder.x} y1={shoulder.y} x2={s.x} y2={s.y} stroke={sleeveColor} strokeWidth={11} strokeLinecap="round" />}
      {cuff && sleeve > 0 && sleeve < 1 && (
        <Line
          x1={shoulder.x + (end.x - shoulder.x) * (sleeve - 0.06)}
          y1={shoulder.y + (end.y - shoulder.y) * (sleeve - 0.06)}
          x2={s.x}
          y2={s.y}
          stroke={cuff}
          strokeWidth={11}
        />
      )}
      <Circle cx={end.x} cy={end.y} r={5.5} fill={skin} />
    </G>
  );
}

function BackHair({ style, color }) {
  switch (style) {
    case 'puff':
      return (
        <G>
          <Circle cx={60} cy={26} r={14} fill={color} />
          <Circle cx={54} cy={22} r={2.6} fill={shade(color, 0.08)} />
          <Circle cx={65} cy={27} r={2.2} fill={shade(color, 0.08)} />
        </G>
      );
    case 'afro':
      return <Circle cx={60} cy={52} r={41} fill={color} />;
    case 'bun':
      return <Circle cx={60} cy={27} r={11} fill={color} />;
    case 'long':
      return <Path d="M31 60 Q28 32 60 28 Q92 32 89 60 L94 128 Q60 138 26 128 Z" fill={color} />;
    case 'braids':
      return (
        <G>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <G key={i}>
              <Ellipse cx={33 - i * 0.6} cy={70 + i * 8} rx={4.5} ry={5} fill={color} />
              <Ellipse cx={87 + i * 0.6} cy={70 + i * 8} rx={4.5} ry={5} fill={color} />
            </G>
          ))}
        </G>
      );
    default:
      return null;
  }
}

function FrontHair({ style, color }) {
  const cap = 'M32 62 Q30 29 60 29 Q90 29 88 62 Q85 43 60 41 Q35 43 32 62 Z';
  switch (style) {
    case 'twists': {
      const twists = [];
      for (let a = 190; a <= 350; a += 11) {
        const rad = (a * Math.PI) / 180;
        const x = 60 + Math.cos(rad) * 30;
        const y = 56 + Math.sin(rad) * 30;
        twists.push(<Ellipse key={a} cx={x} cy={y} rx={4} ry={7.5} fill={color} transform={`rotate(${a + 90} ${x} ${y})`} />);
      }
      // A few twists falling onto the forehead.
      [[50, 40, -15], [58, 42, 5], [67, 40, 20]].forEach(([x, y, r]) =>
        twists.push(<Ellipse key={`f${x}`} cx={x} cy={y} rx={3.5} ry={7} fill={color} transform={`rotate(${r} ${x} ${y})`} />)
      );
      return <G><Path d={cap} fill={color} />{twists}</G>;
    }
    case 'puff':
      return (
        <G>
          <Path d="M32 60 Q31 31 60 31 Q89 31 88 60 Q84 42 60 40 Q36 42 32 60 Z" fill={color} />
          <Ellipse cx={60} cy={33} rx={9} ry={3} fill={shade(color, 0.12)} />
        </G>
      );
    case 'afro':
      return <Path d="M31 58 Q34 34 60 33 Q86 34 89 58 Q80 44 60 43 Q40 44 31 58 Z" fill={color} />;
    case 'short':
      return <G><Path d={cap} fill={color} /><Path d="M50 32 Q62 24 74 34 Q64 30 56 36 Z" fill={color} /></G>;
    case 'buzz':
      return <Path d="M33 58 Q32 32 60 32 Q88 32 87 58 Q83 42 60 41 Q37 42 33 58 Z" fill={color} opacity={0.9} />;
    case 'long':
      return <Path d="M31 66 Q28 28 62 29 Q92 32 89 66 Q84 44 66 40 Q56 50 38 52 Q33 56 31 66 Z" fill={color} />;
    default:
      return <Path d={cap} fill={color} />;
  }
}

function Eye({ cx, cy, kind }) {
  switch (kind) {
    case 'laugh':
      return <Path d={`M${cx - 5} ${cy + 1} Q${cx} ${cy - 5} ${cx + 5} ${cy + 1}`} stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
    case 'closed':
      return <Path d={`M${cx - 5} ${cy} Q${cx} ${cy + 2} ${cx + 5} ${cy}`} stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />;
    case 'sleepy':
      return <Path d={`M${cx - 5} ${cy + 1} Q${cx} ${cy + 3} ${cx + 5} ${cy + 1}`} stroke={INK} strokeWidth={2} fill="none" strokeLinecap="round" />;
    case 'heart':
      return <Path d={`M${cx} ${cy + 4} l-5 -5 a2.8 2.8 0 0 1 5 -3 a2.8 2.8 0 0 1 5 3 z`} fill="#E8364F" />;
    default:
      return (
        <G>
          <Ellipse cx={cx} cy={cy} rx={2.8} ry={3.4} fill={INK} />
          <Circle cx={cx + 1} cy={cy - 1.2} r={0.9} fill="#FFFFFF" />
        </G>
      );
  }
}

const FACES = {
  neutral: { eyes: 'open', mouth: 'M55 77 L65 77', brows: 'flat' },
  happy: { eyes: 'laugh', mouth: 'laugh', brows: 'up' },
  excited: { eyes: 'laugh', mouth: 'bigLaugh', brows: 'up' },
  love: { eyes: 'heart', mouth: 'M53 75 Q60 82 67 75', brows: 'up' },
  calm: { eyes: 'closed', mouth: 'M55 76 Q60 79 65 76', brows: 'flat' },
  missing: { eyes: 'open', mouth: 'M57 78 Q60 75.5 63 78', brows: 'worried' },
  sleepy: { eyes: 'sleepy', mouth: 'o', brows: 'flat' },
  sad: { eyes: 'open', mouth: 'M53 80 Q60 73 67 80', brows: 'worried' },
  angry: { eyes: 'open', mouth: 'M54 78 L66 78', brows: 'angry' },
  anxious: { eyes: 'open', mouth: 'M53 78 q3.5 -3 7 0 q3.5 3 7 0', brows: 'worried' },
  sick: { eyes: 'sleepy', mouth: 'M54 78 q3 -2 6 0 q3 2 6 0', brows: 'worried' },
};

function Face({ emotion, blink }) {
  const face = FACES[emotion] || FACES.neutral;
  const eyeKind = blink && face.eyes === 'open' ? 'closed' : face.eyes;
  const brows = {
    flat: ['M44 54 L54 54', 'M66 54 L76 54'],
    up: ['M44 53 Q49 50 54 53', 'M66 53 Q71 50 76 53'],
    worried: ['M44 54 L54 51', 'M76 54 L66 51'],
    angry: ['M44 51 L54 55', 'M76 51 L66 55'],
  }[face.brows];

  let mouth;
  if (face.mouth === 'laugh' || face.mouth === 'bigLaugh') {
    const depth = face.mouth === 'bigLaugh' ? 90 : 86;
    mouth = (
      <G>
        <Path d={`M52 74 Q60 ${depth} 68 74 Z`} fill={INK} />
        <Path d="M53 74.3 Q60 76.8 67 74.3 L66.2 76.2 Q60 78.2 53.8 76.2 Z" fill="#FFFFFF" />
        <Ellipse cx={60} cy={depth - 6} rx={4} ry={2} fill="#E86A7A" />
      </G>
    );
  } else if (face.mouth === 'o') {
    mouth = <Ellipse cx={60} cy={78} rx={2.5} ry={3} fill={INK} />;
  } else {
    mouth = <Path d={face.mouth} stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />;
  }

  return (
    <G>
      {brows.map((d) => <Path key={d} d={d} stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />)}
      <Eye cx={49} cy={62} kind={eyeKind} />
      <Eye cx={71} cy={62} kind={eyeKind} />
      <Circle cx={42} cy={71} r={4.5} fill={emotion === 'sick' ? '#8FCB9B' : '#E8607A'} opacity={0.3} />
      <Circle cx={78} cy={71} r={4.5} fill={emotion === 'sick' ? '#8FCB9B' : '#E8607A'} opacity={0.3} />
      {mouth}
    </G>
  );
}

function Legs({ avatar, skin }) {
  const { bottom, top, socks, shoes } = avatar;
  const isDress = top.style === 'dress';
  const color = bottom.color;
  const dark = shade(color, -0.12);
  const legs = [[43, 57], [63, 77]];
  const out = [];

  legs.forEach(([x1, x2], i) => out.push(<Rect key={`skin${i}`} x={x1} y={144} width={x2 - x1} height={58} rx={6} fill={skin} />));

  if (!isDress) {
    if (bottom.style === 'jeans' || bottom.style === 'joggers') {
      const end = bottom.style === 'jeans' ? 200 : 196;
      legs.forEach(([x1, x2], i) => {
        out.push(<Path key={`p${i}`} d={`M${x1 - 1} 142 L${x2 + 1} 142 L${x2 + 2} ${end} L${x1 - 2} ${end} Z`} fill={color} />);
        if (bottom.style === 'jeans') out.push(<Line key={`s${i}`} x1={(x1 + x2) / 2} y1={150} x2={(x1 + x2) / 2} y2={end - 2} stroke={shade(color, 0.12)} strokeWidth={0.8} />);
        else out.push(<Rect key={`c${i}`} x={x1 - 2} y={end - 5} width={x2 - x1 + 4} height={5} rx={2} fill={dark} />);
      });
      out.push(<Rect key="waist" x={40} y={140} width={40} height={8} rx={3} fill={color} />);
    } else if (bottom.style === 'cargo_shorts' || bottom.style === 'shorts') {
      const end = bottom.style === 'cargo_shorts' ? 172 : 164;
      out.push(<Path key="shorts" d={`M39 140 L81 140 L83 ${end} L61.5 ${end} L60 152 L58.5 ${end} L37 ${end} Z`} fill={color} />);
      if (bottom.style === 'cargo_shorts') {
        out.push(<Rect key="pl" x={37.5} y={155} width={8} height={11} rx={1.5} fill={dark} />);
        out.push(<Rect key="pr" x={74.5} y={155} width={8} height={11} rx={1.5} fill={dark} />);
      }
    } else if (bottom.style === 'skirt') {
      out.push(<Path key="skirt" d="M39 140 L81 140 L90 176 Q60 182 30 176 Z" fill={color} />);
    }
  }

  const bareShin = isDress || ['cargo_shorts', 'shorts', 'skirt'].includes(bottom.style);
  if (socks && bareShin && shoes.style !== 'boots') {
    legs.forEach(([x1, x2], i) => out.push(<Rect key={`sock${i}`} x={x1} y={180} width={x2 - x1} height={20} rx={3} fill="#F4F4F4" />));
  }
  return <G>{out}</G>;
}

function Shoes({ shoes, skin }) {
  const feet = [50, 70];
  const c = shoes.color;
  return (
    <G>
      {feet.map((cx) => {
        switch (shoes.style) {
          case 'slides':
            return (
              <G key={cx}>
                <Ellipse cx={cx} cy={203} rx={9} ry={4} fill={skin} />
                <Rect x={cx - 11} y={205} width={23} height={4} rx={2} fill={c} />
                <Rect x={cx - 8} y={199.5} width={17} height={5.5} rx={2.5} fill={shade(c, -0.1)} />
              </G>
            );
          case 'boots':
            return (
              <G key={cx}>
                <Rect x={cx - 9} y={186} width={19} height={20} rx={4} fill={c} />
                <Rect x={cx - 11} y={203} width={23} height={5} rx={2} fill={shade(c, -0.25)} />
              </G>
            );
          case 'heels':
            return (
              <G key={cx}>
                <Path d={`M${cx - 9} 200 Q${cx} 196 ${cx + 11} 203 L${cx + 11} 207 L${cx - 9} 205 Z`} fill={c} />
                <Rect x={cx - 9} y={204} width={3} height={6} fill={shade(c, -0.2)} />
              </G>
            );
          case 'barefoot':
            return <Ellipse key={cx} cx={cx + 1} cy={204} rx={10} ry={4.5} fill={skin} />;
          default:
            return (
              <G key={cx}>
                <Rect x={cx - 10} y={197} width={21} height={9} rx={4.5} fill={c} />
                <Rect x={cx - 11} y={204} width={23} height={4} rx={2} fill="#FFFFFF" />
                <Line x1={cx - 3} y1={199} x2={cx + 3} y2={199} stroke="#FFFFFF" strokeWidth={1} />
                <Line x1={cx - 3} y1={201.5} x2={cx + 3} y2={201.5} stroke="#FFFFFF" strokeWidth={1} />
              </G>
            );
        }
      })}
    </G>
  );
}

function Torso({ top, skin }) {
  const c = top.color;
  const dark = shade(c, -0.12);
  const body = 'M40 92 Q60 86 80 92 L83 146 Q60 150 37 146 Z';
  switch (top.style) {
    case 'jersey':
      return (
        <G>
          <Defs>
            <ClipPath id="jerseyClip"><Path d={body} /></ClipPath>
          </Defs>
          <Path d={body} fill={c} />
          <G clipPath="url(#jerseyClip)">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <Line key={i} x1={30 + i * 9} y1={148} x2={46 + i * 9} y2={88} stroke={shade(c, 0.08)} strokeWidth={2} opacity={0.6} />
            ))}
          </G>
          <Path d="M50 89 L60 101 L54 88 Z" fill="#FFFFFF" />
          <Path d="M70 89 L60 101 L66 88 Z" fill="#FFFFFF" />
          <Line x1={60} y1={101} x2={60} y2={110} stroke="#C62828" strokeWidth={1.6} />
          <Circle cx={70} cy={106} r={2.8} fill="#FFFFFF" opacity={0.9} />
        </G>
      );
    case 'hoodie':
      return (
        <G>
          <Path d="M46 90 Q60 98 74 90 Q74 84 60 84 Q46 84 46 90 Z" fill={dark} />
          <Path d={body} fill={c} />
          <Rect x={47} y={124} width={26} height={12} rx={4} fill={dark} />
          <Line x1={56} y1={94} x2={55} y2={108} stroke="#FFFFFF" strokeWidth={1} />
          <Line x1={64} y1={94} x2={65} y2={108} stroke="#FFFFFF" strokeWidth={1} />
        </G>
      );
    case 'tank':
      return (
        <G>
          <Path d="M44 96 Q60 90 76 96 L82 146 Q60 150 38 146 Z" fill={c} />
          <Path d="M52 92 Q60 104 68 92" fill={skin} />
        </G>
      );
    case 'shirt':
      return (
        <G>
          <Path d={body} fill={c} />
          <Path d="M50 89 L60 98 L55 87 Z" fill={dark} />
          <Path d="M70 89 L60 98 L65 87 Z" fill={dark} />
          {[104, 114, 124, 134].map((y) => <Circle key={y} cx={60} cy={y} r={1.1} fill={dark} />)}
        </G>
      );
    case 'dress':
      return (
        <G>
          <Path d="M37 138 L27 184 Q60 192 93 184 L83 138 Z" fill={c} />
          <Path d={body} fill={c} />
          <Path d="M52 90 Q60 100 68 90" fill={skin} />
          <Rect x={38} y={134} width={44} height={4} rx={2} fill={dark} />
        </G>
      );
    case 'tee':
      return <G><Path d={body} fill={c} /><Path d="M54 89 Q60 95 66 89" fill={skin} /></G>;
    default: // fitted_long
      return <G><Path d={body} fill={c} /><Path d="M51 89 Q60 101 69 89" fill={skin} /></G>;
  }
}

const SLEEVE = { fitted_long: 0.85, hoodie: 0.85, jersey: 0.42, tee: 0.4, shirt: 0.5, tank: 0, dress: 0.2 };

/**
 * <Avatar avatar={...} emotion="happy" pose="wave" frame={0} blink={false} size={160} />
 */
export default function Avatar({ avatar: raw, emotion = 'neutral', pose = 'down', frame = 0, blink = false, size = 160 }) {
  const avatar = normalizeAvatar(raw);
  const { skin, hair, top, shoes, accessories } = avatar;
  const has = (a) => accessories.includes(a);
  const frames = POSES[pose] || POSES.down;
  const [leftAngle, rightAngle] = frames[frame % frames.length];
  const shoulderL = { x: 41, y: 97 };
  const shoulderR = { x: 79, y: 97 };
  const bent = leftAngle === 'bent';
  const rightHand = bent ? { x: shoulderR.x + 1, y: shoulderR.y + 36 } : armEnd(shoulderR, rightAngle, 1);
  const leftHand = bent ? { x: shoulderL.x - 1, y: shoulderL.y + 36 } : armEnd(shoulderL, leftAngle, -1);
  const sleeve = SLEEVE[top.style] ?? 0.5;
  const cuff = top.style === 'jersey' ? '#FFFFFF' : null;

  return (
    <Svg width={size * (148 / 224)} height={size} viewBox="-14 -4 148 224">
      <Ellipse cx={60} cy={211} rx={30} ry={5} fill="rgba(0,0,0,0.12)" />
      <BackHair style={hair.style} color={hair.color} />
      <Legs avatar={avatar} skin={skin} />
      <Shoes shoes={shoes} skin={skin} />
      <Torso top={top} skin={skin} />
      {has('necklace') && <Path d="M50 90 Q60 104 70 90" stroke="#D9A441" strokeWidth={1.4} fill="none" />}
      <Arm bent={bent} shoulder={shoulderL} angle={leftAngle} side={-1} sleeve={sleeve} sleeveColor={top.color} skin={skin} cuff={cuff} />
      <Arm bent={bent} shoulder={shoulderR} angle={rightAngle} side={1} sleeve={sleeve} sleeveColor={top.color} skin={skin} cuff={cuff} />
      {has('watch') && <Circle cx={leftHand.x + (shoulderL.x - leftHand.x) * 0.15} cy={leftHand.y + (shoulderL.y - leftHand.y) * 0.15} r={3.4} fill="#D9A441" />}
      {has('microphone') && (
        <G transform={`rotate(${typeof rightAngle === 'number' && rightAngle > 90 ? 200 : -20} ${rightHand.x} ${rightHand.y})`}>
          <Rect x={rightHand.x - 2} y={rightHand.y - 14} width={4} height={14} rx={1.5} fill="#2B2B2B" />
          <Circle cx={rightHand.x} cy={rightHand.y - 17} r={5} fill="#9E9E9E" />
          <Circle cx={rightHand.x} cy={rightHand.y - 17} r={5} fill="none" stroke="#6D6D6D" strokeWidth={0.8} />
        </G>
      )}
      <Rect x={54} y={82} width={12} height={10} rx={3} fill={shade(skin, -0.05)} />
      <Circle cx={33} cy={63} r={4.5} fill={skin} />
      <Circle cx={87} cy={63} r={4.5} fill={skin} />
      <Ellipse cx={60} cy={60} rx={27} ry={29} fill={skin} />
      <Face emotion={emotion} blink={blink} />
      <FrontHair style={hair.style} color={hair.color} />
      {has('hoops') && (
        <G>
          <Circle cx={33} cy={71} r={3.6} stroke="#D9A441" strokeWidth={1.3} fill="none" />
          <Circle cx={87} cy={71} r={3.6} stroke="#D9A441" strokeWidth={1.3} fill="none" />
        </G>
      )}
      {has('studs') && (
        <G>
          <Circle cx={33} cy={67} r={1.6} fill="#E0E0E0" />
          <Circle cx={87} cy={67} r={1.6} fill="#E0E0E0" />
        </G>
      )}
      {(has('glasses') || has('sunglasses')) && (
        <G>
          <Circle cx={49} cy={62} r={7} fill={has('sunglasses') ? 'rgba(20,20,20,0.85)' : 'none'} stroke={INK} strokeWidth={1.6} />
          <Circle cx={71} cy={62} r={7} fill={has('sunglasses') ? 'rgba(20,20,20,0.85)' : 'none'} stroke={INK} strokeWidth={1.6} />
          <Line x1={56} y1={62} x2={64} y2={62} stroke={INK} strokeWidth={1.6} />
        </G>
      )}
      {has('cap') && (
        <G>
          <Path d="M32 50 Q32 26 60 26 Q88 26 88 50 Z" fill={top.color === '#FFFFFF' ? '#222222' : shade(top.color, -0.1)} />
          <Path d="M60 48 Q86 44 100 52 Q84 54 60 52 Z" fill={shade(top.color === '#FFFFFF' ? '#222222' : top.color, -0.25)} />
        </G>
      )}
      {has('beanie') && (
        <G>
          <Path d="M31 50 Q31 22 60 22 Q89 22 89 50 Z" fill="#C62828" />
          <Rect x={30} y={45} width={60} height={8} rx={4} fill="#A31515" />
          <Circle cx={60} cy={20} r={5} fill="#EEEEEE" />
        </G>
      )}
      {has('flower') && (
        <G>
          {[0, 72, 144, 216, 288].map((d) => (
            <Circle key={d} cx={82 + 4 * Math.cos((d * Math.PI) / 180)} cy={40 + 4 * Math.sin((d * Math.PI) / 180)} r={3.4} fill="#F48FB1" />
          ))}
          <Circle cx={82} cy={40} r={2.4} fill="#F9A825" />
        </G>
      )}
    </Svg>
  );
}
