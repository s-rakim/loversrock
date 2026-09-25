// The drawing canvas.
//
// Strokes are point lists with styling attached, never a rasterized image,
// so the receiving phone re-renders them as real vectors at its own
// resolution — and so undo is free, because a stroke is a thing in a list
// rather than pixels already burned into a bitmap.
//
// The tools, the palette and the renderer all live in components/Doodle.js,
// shared with the message bubble and Draw Duel.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder, Alert, ScrollView, Pressable,
} from 'react-native';
import Svg from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../services/api';
import { spacing, radius } from '../theme';
import { MorphButton, Pop } from '../components/Motion';
import { useTheme } from '../components/ThemeContext';
import {
  StrokePath, PALETTE, WIDTHS, TOOLS, CANVAS_COLORS,
} from '../components/Doodle';

export default function CanvasScreen({ navigation, route }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Opened from the gallery, this screen is handed an existing drawing to
  // carry on with. Seeded into state rather than fetched here, because the
  // gallery already has the strokes by the time it navigates.
  const opened = route?.params || {};

  const [strokes, setStrokes] = useState(opened.strokes || []);
  const [undone, setUndone] = useState([]);
  const [color, setColor] = useState('#FF5C8D');
  const [width, setWidth] = useState(6);
  const [tool, setTool] = useState('pen');
  const [canvasColor, setCanvasColor] = useState(opened.canvasColor || '#FFFDF8');
  const [panel, setPanel] = useState('color'); // color | width | tool | paper
  const [saving, setSaving] = useState(false);
  const [drawingId, setDrawingId] = useState(opened.drawingId || null);
  // The strokes as last written to the server, so "save" can tell whether
  // there is anything to write and the back-guard can tell whether there is
  // anything to lose.
  const savedCount = useRef((opened.strokes || []).length);

  const currentStroke = useRef([]);
  const [, forceRender] = useState(0);
  // PanResponder is built once, so it would capture the first render's tool
  // and colour forever. These refs are what let it read the current ones.
  const styleRef = useRef({ color, width, tool });
  styleRef.current = { color, width, tool };

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
        if (currentStroke.current.length > 0) {
          const { color: c, width: w, tool: t } = styleRef.current;
          setStrokes((prev) => [...prev, { points: currentStroke.current, color: c, width: w, tool: t }]);
          // A new stroke discards the redo stack, as every editor does.
          setUndone([]);
        }
        currentStroke.current = [];
        forceRender((n) => n + 1);
      },
    })
  ).current;

  const live = currentStroke.current.length > 0
    ? { points: currentStroke.current, color, width, tool }
    : null;

  function undo() {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      setUndone((u) => [...u, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function redo() {
    setUndone((prev) => {
      if (prev.length === 0) return prev;
      setStrokes((s) => [...s, prev[prev.length - 1]]);
      return prev.slice(0, -1);
    });
  }

  function clear() {
    if (strokes.length === 0) return;
    Alert.alert('Clear the whole drawing?', 'Undo can bring back one stroke at a time instead.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => { setStrokes([]); setUndone([]); currentStroke.current = []; forceRender((n) => n + 1); },
      },
    ]);
  }

  // Kept, rather than sent.
  //
  // The two destinations are genuinely different things and both are worth
  // having: the thread is for "look at this now", the gallery is for the one
  // you spent twenty minutes on and want back next week.
  async function keep() {
    if (strokes.length === 0) {
      Alert.alert('Nothing drawn yet', 'Draw something first.');
      return;
    }
    setSaving(true);
    try {
      const body = { strokeData: { strokes }, canvasColor };
      const { drawing } = drawingId
        ? await apiFetch(`/canvas/${drawingId}`, { method: 'PUT', body })
        : await apiFetch('/canvas', { method: 'POST', body });
      // Saving again updates the same drawing rather than making a second
      // copy of it, which is what makes "keep adding to it" work at all.
      setDrawingId(drawing.id);
      savedCount.current = strokes.length;
      navigation.navigate('Doodle');
    } catch (err) {
      Alert.alert('Could not save it', err.message);
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    if (strokes.length === 0) {
      Alert.alert('Nothing drawn yet', 'Draw something first.');
      return;
    }
    setSaving(true);
    try {
      // The canvas colour travels with the drawing: without it an eraser
      // stroke would be drawn in the wrong colour on the other phone, and a
      // drawing made on the dark canvas would come out on a light one.
      await apiFetch('/messages', {
        method: 'POST',
        body: { type: 'doodle', strokeData: { strokes, canvasColor } },
      });
      // Sending counts as a destination, so the leave-guard must not then
      // ask whether to discard work that has just been delivered.
      savedCount.current = strokes.length;
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not send doodle', err.message);
    } finally {
      setSaving(false);
    }
  }

  // Leaving with unsaved strokes.
  //
  // This screen is reached from the gallery, and the hardware back button is
  // right next to everything else — losing twenty minutes of drawing to a
  // stray tap is the kind of thing that stops people using a feature at all.
  // Only strokes drawn SINCE the last save count, so saving and then leaving
  // is silent, as it should be.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (strokes.length === savedCount.current) return;
    e.preventDefault();
    Alert.alert('Leave without keeping this?', 'The strokes you have added since the last save will be gone.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Keep it', onPress: keep },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [navigation, strokes.length, keep]);

  const activeTool = TOOLS.find((t) => t.id === tool);

  return (
    <View style={styles.container}>
      <View style={[styles.canvas, { backgroundColor: canvasColor }]} {...panResponder.panHandlers}>
        <Svg style={StyleSheet.absoluteFill}>
          {strokes.map((stroke, i) => (
            <StrokePath key={i} stroke={stroke} index={i} canvasColor={canvasColor} />
          ))}
          {live && <StrokePath stroke={live} index={strokes.length} canvasColor={canvasColor} />}
        </Svg>
      </View>

      {/* Which panel is open — colour, size, tool or paper. */}
      <View style={styles.tabs}>
        {[
          ['color', 'Colour', 'color-palette-outline'],
          ['width', 'Size', 'resize-outline'],
          ['tool', activeTool?.label || 'Tool', activeTool?.icon || 'brush-outline'],
          ['paper', 'Paper', 'document-outline'],
        ].map(([id, label, icon]) => (
          <Pressable key={id} onPress={() => setPanel(id)} style={styles.tab}>
            <Pop active={panel === id}>
              <View style={[styles.tabIcon, panel === id && styles.tabIconActive]}>
                <Ionicons
                  name={icon}
                  size={18}
                  color={panel === id ? '#fff' : colors.textPrimary}
                />
              </View>
            </Pop>
            <Text style={[font.muted, styles.tabLabel]}>{label}</Text>
          </Pressable>
        ))}

        <View style={styles.preview}>
          <View
            style={[
              styles.previewDot,
              {
                width: Math.max(8, width * 1.5),
                height: Math.max(8, width * 1.5),
                borderRadius: Math.max(4, width * 0.75),
                backgroundColor: tool === 'eraser' ? canvasColor : color,
                borderColor: colors.border,
              },
            ]}
          />
        </View>
      </View>

      <View style={styles.panel}>
        {panel === 'color' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {PALETTE.map((swatch) => (
              <Pressable key={swatch} onPress={() => { setColor(swatch); if (tool === 'eraser') setTool('pen'); }}>
                <Pop active={color === swatch && tool !== 'eraser'}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: swatch },
                      color === swatch && tool !== 'eraser' && styles.swatchActive,
                    ]}
                  />
                </Pop>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {panel === 'width' && (
          <View style={styles.widthRow}>
            {WIDTHS.map((w) => (
              <Pressable key={w} onPress={() => setWidth(w)} style={styles.widthCell}>
                <Pop active={width === w}>
                  <View style={[styles.widthChip, width === w && styles.widthChipActive]}>
                    <View
                      style={{
                        width: w * 1.6, height: w * 1.6, borderRadius: w * 0.8,
                        backgroundColor: width === w ? '#fff' : colors.textPrimary,
                      }}
                    />
                  </View>
                </Pop>
                <Text style={[font.muted, { fontSize: 10 }]}>{w}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {panel === 'tool' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {TOOLS.map((t) => (
              <Pressable key={t.id} onPress={() => setTool(t.id)} style={styles.toolCell}>
                <Pop active={tool === t.id}>
                  <View style={[styles.toolChip, tool === t.id && styles.toolChipActive]}>
                    <Ionicons
                      name={t.icon}
                      size={20}
                      color={tool === t.id ? '#fff' : colors.textPrimary}
                    />
                  </View>
                </Pop>
                <Text style={[font.muted, { fontSize: 10 }]}>{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {panel === 'paper' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {CANVAS_COLORS.map((paper) => (
              <Pressable key={paper.id} onPress={() => setCanvasColor(paper.value)} style={styles.toolCell}>
                <Pop active={canvasColor === paper.value}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: paper.value },
                      canvasColor === paper.value && styles.swatchActive,
                    ]}
                  />
                </Pop>
                <Text style={[font.muted, { fontSize: 10 }]}>{paper.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.toolbar}>
        <MorphButton onPress={undo} disabled={strokes.length === 0} style={[styles.iconButton, strokes.length === 0 && styles.disabled]}>
          <Ionicons name="arrow-undo-outline" size={20} color={colors.textPrimary} />
        </MorphButton>
        <MorphButton onPress={redo} disabled={undone.length === 0} style={[styles.iconButton, undone.length === 0 && styles.disabled]}>
          <Ionicons name="arrow-redo-outline" size={20} color={colors.textPrimary} />
        </MorphButton>
        <MorphButton onPress={clear} style={styles.iconButton}>
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
        </MorphButton>
        <MorphButton onPress={keep} disabled={saving} style={[styles.keepButton, saving && styles.disabled]}>
          <Ionicons name="bookmark-outline" size={18} color={colors.accentIndigo} />
          <Text style={styles.keepText}>{drawingId ? 'Update' : 'Keep'}</Text>
        </MorphButton>
        <MorphButton onPress={send} disabled={saving} style={[styles.sendButton, saving && styles.disabled]}>
          <Ionicons name="send" size={18} color="#fff" />
          <Text style={styles.sendText}>{saving ? 'Sending…' : 'Send'}</Text>
        </MorphButton>
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent', padding: spacing.md },
    canvas: {
      flex: 1, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    },
    tabs: {
      flexDirection: 'row', alignItems: 'center',
      marginTop: spacing.md, gap: spacing.xs,
    },
    tab: { alignItems: 'center', flex: 1 },
    tabIcon: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    tabIconActive: { backgroundColor: colors.accentIndigo },
    tabLabel: { fontSize: 10, marginTop: 2 },
    preview: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border,
    },
    previewDot: { borderWidth: 1 },
    panel: {
      marginTop: spacing.sm, minHeight: 66, justifyContent: 'center',
      backgroundColor: colors.surface, borderRadius: radius.card,
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderWidth: 1, borderColor: colors.border,
    },
    swatch: {
      width: 38, height: 38, borderRadius: 19, marginHorizontal: 4,
      borderWidth: 2, borderColor: colors.border,
    },
    swatchActive: { borderColor: colors.accentPink, borderWidth: 3 },
    widthRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
    widthCell: { alignItems: 'center' },
    widthChip: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    widthChipActive: { backgroundColor: colors.accentPink },
    toolCell: { alignItems: 'center', marginHorizontal: 4 },
    toolChip: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    toolChipActive: { backgroundColor: colors.accentIndigo },
    toolbar: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    iconButton: {
      width: 52, height: 48, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1, borderColor: colors.border,
    },
    disabled: { opacity: 0.4 },
    keepButton: {
      flex: 1, flexDirection: 'row', gap: spacing.xs,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface, borderRadius: radius.pill,
      borderWidth: 1.5, borderColor: colors.accentIndigo,
    },
    keepText: { color: colors.accentIndigo, fontWeight: '700' },
    sendButton: {
      flex: 1, flexDirection: 'row', gap: spacing.xs,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.accentPink, borderRadius: radius.pill,
    },
    sendText: { color: '#fff', fontWeight: '700' },
  });
