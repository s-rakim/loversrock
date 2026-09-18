import React, { useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, Alert } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { apiFetch } from '../services/api';
import { colors, spacing, radius } from '../theme';
import { MorphButton } from '../components/Motion';
import { Text } from 'react-native';

// Real freehand drawing via PanResponder — strokes are sent as an array of
// {x,y} point lists (stroke_data), never rasterized to an image, so the
// receiving side can re-render them as real react-native-svg paths.
export default function CanvasScreen({ navigation }) {
  const [strokes, setStrokes] = useState([]);
  const currentStroke = useRef([]);
  const [, forceRender] = useState(0);
  const [saving, setSaving] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        currentStroke.current = [{ x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY }];
        forceRender((n) => n + 1);
      },
      onPanResponderMove: (evt) => {
        currentStroke.current = [
          ...currentStroke.current,
          { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY },
        ];
        forceRender((n) => n + 1);
      },
      onPanResponderRelease: () => {
        if (currentStroke.current.length > 1) {
          setStrokes((prev) => [...prev, currentStroke.current]);
        }
        currentStroke.current = [];
      },
    })
  ).current;

  function clear() {
    setStrokes([]);
    currentStroke.current = [];
    forceRender((n) => n + 1);
  }

  async function send() {
    if (strokes.length === 0) {
      Alert.alert('Nothing drawn yet', 'Draw something first.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/messages', {
        method: 'POST',
        body: { type: 'doodle', strokeData: strokes },
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not send doodle', err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.canvas} {...panResponder.panHandlers}>
        <Svg style={StyleSheet.absoluteFill}>
          {strokes.map((stroke, i) => (
            <Polyline
              key={i}
              points={stroke.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentStroke.current.length > 1 && (
            <Polyline
              points={currentStroke.current.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
      </View>

      <View style={styles.toolbar}>
        <MorphButton onPress={clear} style={styles.toolButton}>
          <Text style={{ color: colors.text }}>Clear</Text>
        </MorphButton>
        <MorphButton onPress={send} disabled={saving} style={[styles.toolButton, styles.sendButton]}>
          <Text style={{ color: '#000', fontWeight: '700' }}>{saving ? 'Sending…' : 'Send'}</Text>
        </MorphButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  canvas: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  toolbar: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  toolButton: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: 'center' },
  sendButton: { backgroundColor: colors.accent },
});
