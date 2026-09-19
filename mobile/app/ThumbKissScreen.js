import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, PanResponder, Vibration, Dimensions } from 'react-native';
import { connectSocket } from '../services/api';
import { spacing } from '../theme';
import { PulsingText } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import { useTheme } from '../components/ThemeContext';

const { width, height } = Dimensions.get('window');
const TOUCH_AREA_SIZE = Math.min(width - spacing.lg * 2, 420);
const CONNECT_THRESHOLD = 0.12; // normalized distance (0..1 space)

export default function ThumbKissScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors, font), [colors, font]);
  const [myPos, setMyPos] = useState(null);
  const [partnerPos, setPartnerPos] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    connectSocket().then((socket) => {
      socketRef.current = socket;
      socket.on('thumbkiss:partner-move', ({ x, y }) => setPartnerPos({ x, y }));
      socket.on('thumbkiss:partner-release', () => setPartnerPos(null));
    });
    return () => {
      socketRef.current?.off('thumbkiss:partner-move');
      socketRef.current?.off('thumbkiss:partner-release');
    };
  }, []);

  useEffect(() => {
    if (!myPos || !partnerPos) {
      setConnected(false);
      return;
    }
    const dist = Math.hypot(myPos.x - partnerPos.x, myPos.y - partnerPos.y);
    const isConnected = dist < CONNECT_THRESHOLD;
    if (isConnected && !connected) Vibration.vibrate(200);
    setConnected(isConnected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPos, partnerPos]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        const x = evt.nativeEvent.locationX / TOUCH_AREA_SIZE;
        const y = evt.nativeEvent.locationY / TOUCH_AREA_SIZE;
        setMyPos({ x, y });
        socketRef.current?.emit('thumbkiss:move', { x, y });
      },
      onPanResponderRelease: () => {
        setMyPos(null);
        socketRef.current?.emit('thumbkiss:release', {});
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      <StickerField variant="celebrate" />
      <Text style={[font.muted, { marginBottom: spacing.md, textAlign: 'center' }]}>
        Both partners touch the circle at the same time — hold your thumbs together to connect.
      </Text>

      <View
        style={[styles.touchArea, connected && styles.touchAreaConnected]}
        {...panResponder.panHandlers}
      >
        {myPos && (
          <View style={[styles.dot, styles.myDot, { left: myPos.x * TOUCH_AREA_SIZE - 20, top: myPos.y * TOUCH_AREA_SIZE - 20 }]} />
        )}
        {partnerPos && (
          <View
            style={[styles.dot, styles.partnerDot, { left: partnerPos.x * TOUCH_AREA_SIZE - 20, top: partnerPos.y * TOUCH_AREA_SIZE - 20 }]}
          />
        )}
      </View>

      {connected && (
        <View style={styles.connectedRow}>
          <Icon name="heart" size={18} color={colors.accent} />
          <PulsingText style={styles.connectedText}>Connected</PulsingText>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors, font) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  touchArea: {
    width: TOUCH_AREA_SIZE, height: TOUCH_AREA_SIZE, borderRadius: TOUCH_AREA_SIZE / 2,
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, overflow: 'hidden',
  },
  touchAreaConnected: { borderColor: colors.accent },
  dot: { position: 'absolute', width: 40, height: 40, borderRadius: 20, opacity: 0.85 },
  myDot: { backgroundColor: colors.accent },
  partnerDot: { backgroundColor: '#6affe0' },
  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg },
  connectedText: { ...font.h2, color: colors.accent },
});
