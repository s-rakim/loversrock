// The live couple characters. Each one idles (breathes, bobs, blinks), acts
// out its person's current mood — pose, face and a signature motion — and
// waves + hops when tapped. The characters are drawn from each person's
// wardrobe (components/avatar), so outfits changed in the Wardrobe show up
// here and on the partner's phone.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Easing, Pressable, StyleSheet } from 'react-native';
import Avatar from './avatar/Avatar';
import { heightFactor, useMascotSize } from './avatar/sizing';
import Stage3D from './avatar3d/Stage3D';

// 3D is the default. If a device can't create a GL context, every character
// quietly falls back to the 2D drawing for the rest of the session.
let gl3dFailed = false;
function use3D() {
  const [ok, setOk] = useState(!gl3dFailed);
  const fail = () => { gl3dFailed = true; setOk(false); };
  return [ok, fail];
}
import { HeartShape } from './Stickers';
import { colors } from '../theme';

const MOTION = {
  neutral: { bob: 3, period: 1800, pose: 'down' },
  happy: { bob: 6, period: 900, pose: 'down', move: 'bounce', waveEvery: 6000 },
  love: { bob: 4, period: 1200, pose: 'heart', move: 'heartbeat', particles: 'hearts' },
  excited: { bob: 9, period: 520, pose: 'cheer', move: 'wiggle', particles: 'sparkles', frames: 260 },
  calm: { bob: 2, period: 3000, pose: 'down' },
  missing: { bob: 2, period: 2200, pose: 'hug', move: 'look' },
  sleepy: { bob: 2, period: 3200, pose: 'droop', tilt: -6, particles: 'z' },
  sad: { bob: 1, period: 2600, pose: 'droop', tilt: 5, droop: 4, particles: 'tear' },
  angry: { bob: 1, period: 1000, pose: 'hips', move: 'shake' },
  anxious: { bob: 1, period: 600, pose: 'down', move: 'jitter' },
  sick: { bob: 1, period: 2800, pose: 'droop', tilt: 4 },
};

export const EMOTION_LABELS = {
  neutral: 'okay', happy: 'happy', love: 'loved up', excited: 'excited', calm: 'calm', missing: 'missing you',
  sleepy: 'sleepy', sad: 'sad', angry: 'grumpy', anxious: 'stressed', sick: 'unwell',
};

function Particles({ kind, width, height }) {
  const items = useRef(Array.from({ length: 3 }, (_, i) => ({ v: new Animated.Value(0), delay: i * 700, x: (i - 1) * width * 0.25 }))).current;
  useEffect(() => {
    if (!kind) return undefined;
    const anim = Animated.parallel(items.map(({ v, delay }) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 2100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]))
    ));
    anim.start();
    return () => anim.stop();
  }, [kind]);
  if (!kind) return null;
  return items.map(({ v, x }, i) => {
    const up = kind !== 'tear';
    return (
      <Animated.View
        key={i}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: width / 2 + x - 8,
          top: up ? height * 0.05 : height * 0.3,
          opacity: v.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, up ? -height * 0.2 : height * 0.15] }) }],
        }}
      >
        {kind === 'hearts' ? <HeartShape size={14} /> : (
          <Text style={{ fontSize: 15, color: kind === 'tear' ? '#6BA8FF' : kind === 'z' ? colors.textMuted : colors.gold, fontWeight: '700' }}>
            {kind === 'z' ? 'z' : kind === 'tear' ? '💧' : '✦'}
          </Text>
        )}
      </Animated.View>
    );
  });
}

/**
 * One live character.
 *   avatar  — wardrobe config (see components/avatar/wardrobe.js)
 *   emotion — see components/moods.js
 *   size    — height in px
 *   label   — optional name under the character
 */
export function Mascot2D({ avatar, emotion = 'neutral', size: baseSize, context = 'hero', label, sublabel, onPress, onLongPress, style, delay = 0 }) {
  const motion = MOTION[emotion] || MOTION.neutral;
  // `size` is the height of a default-height character; each person's own
  // height setting scales from there, so the couple keeps its proportions.
  const responsive = useMascotSize(context);
  const size = Math.round((baseSize || responsive) * heightFactor(avatar));
  const width = size * (148 / 224);
  const bob = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const move = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(0)).current;
  const [blink, setBlink] = useState(false);
  const [waving, setWaving] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(bob, { toValue: 1, duration: motion.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: motion.period / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [emotion]);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    move.setValue(0);
    if (!motion.move) return undefined;
    const dur = { bounce: 900, heartbeat: 1100, wiggle: 520, look: 2600, shake: 900, jitter: 300 }[motion.move];
    const loop = Animated.loop(Animated.timing(move, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [emotion]);

  // Pop in whenever the mood changes so a partner's update is noticeable.
  useEffect(() => {
    entrance.setValue(0);
    Animated.spring(entrance, { toValue: 1, friction: 4, tension: 70, useNativeDriver: true }).start();
  }, [emotion]);

  // Blinking.
  useEffect(() => {
    let timer;
    let reopen;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        reopen = setTimeout(() => setBlink(false), 130);
        schedule();
      }, 2200 + Math.random() * 3200);
    };
    schedule();
    return () => { clearTimeout(timer); clearTimeout(reopen); };
  }, []);

  // Two-frame poses (waving, cheering) flip between frames.
  useEffect(() => {
    if (!waving && !motion.frames) return undefined;
    const id = setInterval(() => setFrame((f) => f + 1), waving ? 220 : motion.frames);
    return () => clearInterval(id);
  }, [waving, emotion]);

  // Happy characters wave on their own every so often.
  useEffect(() => {
    if (!motion.waveEvery) return undefined;
    const id = setInterval(() => wave(false), motion.waveEvery + Math.random() * 3000);
    return () => clearInterval(id);
  }, [emotion]);

  function wave(withHop = true) {
    setWaving(true);
    setTimeout(() => setWaving(false), 1300);
    if (withHop) {
      hop.setValue(0);
      Animated.sequence([
        Animated.timing(hop, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0, duration: 240, easing: Easing.bounce, useNativeDriver: true }),
      ]).start();
    }
  }

  const zero = new Animated.Value(0);
  const translateY = Animated.add(
    Animated.add(
      bob.interpolate({ inputRange: [0, 1], outputRange: [motion.droop || 0, (motion.droop || 0) - motion.bob] }),
      hop.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.12] })
    ),
    motion.move === 'bounce' ? move.interpolate({ inputRange: [0, 0.3, 0.5, 1], outputRange: [0, -size * 0.05, 0, 0] }) : zero
  );
  const translateX = motion.move === 'shake'
    ? move.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 0.4, 1], outputRange: [0, -3, 3, -3, 0, 0] })
    : motion.move === 'jitter'
      ? move.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 1.2, -1.2, 0.8, 0] })
      : motion.move === 'look'
        ? move.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -5, 0, 5, 0] })
        : zero;
  const rotate = motion.move === 'wiggle'
    ? move.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: ['0deg', '-5deg', '5deg', '0deg'] })
    : `${motion.tilt || 0}deg`;
  const scale = Animated.multiply(
    Animated.multiply(
      breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }),
      motion.move === 'heartbeat' ? move.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 1], outputRange: [1, 1.06, 1, 1.04, 1] }) : new Animated.Value(1)
    ),
    entrance.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] })
  );

  return (
    <View style={[{ alignItems: 'center' }, style]}>
      <Pressable onPress={() => { wave(); onPress?.(); }} onLongPress={onLongPress} hitSlop={6}>
        <View style={{ width, height: size }}>
          <Animated.View style={{ transform: [{ translateX }, { translateY }, { rotate }, { scale }] }}>
            <Avatar avatar={avatar} emotion={emotion} pose={waving ? 'wave' : motion.pose} frame={frame} blink={blink} size={size} />
          </Animated.View>
          <Particles kind={motion.particles} width={width} height={size} />
        </View>
      </Pressable>
      {label ? <Text style={styles.label} numberOfLines={1}>{label}</Text> : null}
      {sublabel ? <Text style={styles.sublabel} numberOfLines={1}>{sublabel}</Text> : null}
    </View>
  );
}

/**
 * One live 3D character (falls back to Mascot2D). Same props as Mascot2D.
 */
export default function Mascot(props) {
  const { avatar, emotion = 'neutral', size: baseSize, context = 'hero', label, sublabel, onPress, onLongPress, style } = props;
  const [ok, fail] = use3D();
  const responsive = useMascotSize(context);
  const [pokeAt, setPokeAt] = useState(0);
  if (!ok) return <Mascot2D {...props} />;
  const size = baseSize || responsive;
  const width = size * 0.78;
  const motion = MOTION[emotion] || MOTION.neutral;
  return (
    <View style={[{ alignItems: 'center' }, style]}>
      <Pressable onPress={() => { setPokeAt(Date.now()); onPress?.(); }} onLongPress={onLongPress} hitSlop={6}>
        <View style={{ width, height: size }}>
          <Stage3D characters={[{ avatar, emotion, pokeAt }]} width={width} height={size} spanX={1.5} onError={fail} />
          <Particles kind={motion.particles} width={width} height={size} />
        </View>
      </Pressable>
      {label ? <Text style={styles.label} numberOfLines={1}>{label}</Text> : null}
      {sublabel ? <Text style={styles.sublabel} numberOfLines={1}>{sublabel}</Text> : null}
    </View>
  );
}

/**
 * Both characters side by side — the Home header and the loading screen.
 * Each shows its own person's mood: on my phone, my partner's character wears
 * their mood and mine wears mine; on theirs, the reverse.
 */
export function CoupleMascots(props) {
  const [ok, fail] = use3D();
  return ok ? <Couple3D {...props} onFail={fail} /> : <Couple2D {...props} />;
}

// Both characters share one 3D scene, standing close like the photo. Each
// half of the stage is its own tap target.
function Couple3D({ me, partner, size, context = 'home', onPressPartner, onPressMe, onLongPressMe, showLabels = true, onFail }) {
  const responsive = useMascotSize(context);
  const base = size || responsive;
  const width = base * 1.3;
  const [pokes, setPokes] = useState({ me: 0, partner: 0 });
  const poke = (who) => setPokes((p) => ({ ...p, [who]: Date.now() }));
  const pMotion = MOTION[partner?.emotion] || MOTION.neutral;
  const mMotion = MOTION[me?.emotion] || MOTION.neutral;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width, height: base }}>
        <Stage3D
          width={width}
          height={base}
          spanX={2.1}
          onError={onFail}
          characters={[
            { avatar: partner?.avatar, emotion: partner?.emotion || 'neutral', x: -0.42, pokeAt: pokes.partner },
            { avatar: me?.avatar, emotion: me?.emotion || 'neutral', x: 0.42, pokeAt: pokes.me },
          ]}
        />
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
          <View style={{ flex: 1 }}><Particles kind={pMotion.particles} width={width / 2} height={base} /></View>
          <View style={{ flex: 1 }}><Particles kind={mMotion.particles} width={width / 2} height={base} /></View>
        </View>
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
          <Pressable style={{ flex: 1 }} onPress={() => { poke('partner'); onPressPartner?.(); }} />
          <Pressable style={{ flex: 1 }} onPress={() => { poke('me'); onPressMe?.(); }} onLongPress={onLongPressMe} />
        </View>
      </View>
      {showLabels && (
        <View style={{ flexDirection: 'row', width }}>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.label} numberOfLines={1}>{partner?.name}</Text>
            {partner?.moodText ? <Text style={styles.sublabel} numberOfLines={1}>{partner.moodText}</Text> : null}
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.label}>You</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function Couple2D({ me, partner, size, context = 'home', onPressPartner, onPressMe, onLongPressMe, showLabels = true }) {
  const responsive = useMascotSize(context);
  const base = size || responsive;
  return (
    <View style={styles.couple}>
      <Mascot2D
        avatar={partner?.avatar}
        emotion={partner?.emotion || 'neutral'}
        size={base}
        delay={300}
        label={showLabels ? partner?.name : null}
        sublabel={showLabels && partner?.moodText ? partner.moodText : null}
        onPress={onPressPartner}
      />
      {/* Standing close, like the photo: a slight overlap rather than a gap. */}
      <Mascot2D
        style={{ marginLeft: -base * 0.3 }}
        avatar={me?.avatar}
        emotion={me?.emotion || 'neutral'}
        size={base}
        label={showLabels ? 'You' : null}
        onPress={onPressMe}
        onLongPress={onLongPressMe}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  couple: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  label: { marginTop: 2, fontSize: 13, fontWeight: '700', color: colors.text, maxWidth: 140 },
  sublabel: { fontSize: 11, color: colors.textMuted, maxWidth: 140 },
});
