// The shared Canvas: one drawing both partners work on live. Tools: pen,
// eraser, eyedropper (tap a line to borrow its colour), hand (pan while
// zoomed), colours, brush sizes, zoom, undo (your own strokes), clear,
// paper colour, and save to the Gallery. The drawing also feeds the Canvas
// home screen widget.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, Alert, ScrollView, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiFetch, connectSocket } from '../services/api';
import { useCouple } from '../components/CoupleContext';
import StrokeView, { CANVAS_H, CANVAS_W } from '../components/StrokeView';
import { Chip } from '../components/ui';
import Icon from '../components/Icon';
import { refreshWidgets } from '../services/widgetBridge';
import { useI18n } from '../i18n';
import { colors, font, spacing, radius } from '../theme';

const PALETTE = ['#2B2320', '#E8607A', '#C62828', '#FF8A65', '#F9A825', '#8BC34A', '#00897B', '#3FB8AF', '#2B3F8C', '#7B1FA2', '#F48FB1', '#8C7F79', '#FFFFFF'];
const SIZES = [0.004, 0.008, 0.016, 0.03];
const PAPERS = ['#FFFFFF', '#FFF6E5', '#FCE1E6', '#E3F2FD', '#1F2A44'];
const ZOOMS = [1, 1.5, 2, 3];

export default function SharedCanvasScreen({ navigation }) {
  const { t } = useI18n();
  const { me } = useCouple();
  const [strokes, setStrokes] = useState([]);
  const [background, setBackground] = useState('#FFFFFF');
  const [color, setColor] = useState(PALETTE[1]);
  const [size, setSize] = useState(SIZES[1]);
  const [tool, setTool] = useState('pen');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [live, setLive] = useState(null);
  const [layout, setLayout] = useState({ w: 1, h: 1 });

  const state = useRef({});
  state.current = { strokes, color, size, tool, zoom, pan, layout, background };
  const drawing = useRef(null);
  const panStart = useRef(null);

  const load = useCallback(() => apiFetch('/canvas').then(({ canvas }) => {
    setStrokes(canvas.strokes);
    setBackground(canvas.background);
  }).catch((err) => Alert.alert(t('common.error'), err.message)), []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    let socket;
    const onStrokes = ({ strokes: incoming, fromUserId }) => {
      if (fromUserId !== me?.id) setStrokes((prev) => [...prev, ...incoming]);
    };
    const onReset = ({ strokes: all, background: bg }) => {
      setStrokes(all || []);
      if (bg) setBackground(bg);
    };
    connectSocket().then((s) => { socket = s; s.on('canvas:strokes', onStrokes); s.on('canvas:reset', onReset); }).catch(() => {});
    return () => { socket?.off('canvas:strokes', onStrokes); socket?.off('canvas:reset', onReset); };
  }, [me?.id]);

  // Screen touch → normalised canvas point, accounting for zoom + pan.
  const toPoint = (evt) => {
    const { layout: l, zoom: z, pan: p } = state.current;
    return {
      x: Math.min(1, Math.max(0, p.x + evt.nativeEvent.locationX / l.w / z)),
      y: Math.min(1, Math.max(0, p.y + evt.nativeEvent.locationY / l.h / z)),
    };
  };

  function pickColorAt(pt) {
    let best = null;
    let bestDist = 0.03;
    for (const s of state.current.strokes) {
      if (s.tool === 'eraser') continue;
      for (const q of s.points) {
        const d = Math.hypot(q.x - pt.x, (q.y - pt.y) * (CANVAS_H / CANVAS_W));
        if (d < bestDist) { bestDist = d; best = s.color; }
      }
    }
    if (best) {
      setColor(best);
      setTool('pen');
    }
  }

  async function commit(stroke) {
    setStrokes((prev) => [...prev, stroke]);
    setLive(null);
    try {
      await apiFetch('/canvas/strokes', { method: 'POST', body: { strokes: [stroke] } });
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
      load();
    }
  }

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      const s = state.current;
      if (s.tool === 'eyedropper') { pickColorAt(toPoint(evt)); return; }
      if (s.tool === 'hand') { panStart.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY, pan: s.pan }; return; }
      drawing.current = { color: s.color, width: s.size / Math.sqrt(s.zoom), tool: s.tool === 'eraser' ? 'eraser' : 'pen', points: [toPoint(evt)] };
      setLive({ ...drawing.current });
    },
    onPanResponderMove: (evt) => {
      const s = state.current;
      if (s.tool === 'hand' && panStart.current) {
        const dx = (evt.nativeEvent.pageX - panStart.current.x) / s.layout.w / s.zoom;
        const dy = (evt.nativeEvent.pageY - panStart.current.y) / s.layout.h / s.zoom;
        const max = 1 - 1 / s.zoom;
        setPan({ x: Math.min(max, Math.max(0, panStart.current.pan.x - dx)), y: Math.min(max, Math.max(0, panStart.current.pan.y - dy)) });
        return;
      }
      if (!drawing.current) return;
      drawing.current.points.push(toPoint(evt));
      setLive({ ...drawing.current });
    },
    onPanResponderRelease: () => {
      panStart.current = null;
      if (drawing.current) commit(drawing.current);
      drawing.current = null;
    },
  })).current;

  function setZoomLevel(z) {
    setZoom(z);
    const max = 1 - 1 / z;
    setPan((p) => ({ x: Math.min(max, p.x), y: Math.min(max, p.y) }));
    if (z === 1) setTool((tl) => (tl === 'hand' ? 'pen' : tl));
  }

  async function undo() {
    try {
      const { strokes: next } = await apiFetch('/canvas/undo', { method: 'POST' });
      setStrokes(next);
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }
  function clear() {
    Alert.alert(t('canvas.clearTitle'), t('canvas.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('canvas.saveAndClear'), onPress: () => save(true) },
      { text: t('canvas.clear'), style: 'destructive', onPress: () => apiFetch('/canvas', { method: 'DELETE' }).then(() => setStrokes([])) },
    ]);
  }
  async function save(clearAfter = false) {
    try {
      await apiFetch('/canvas/save', { method: 'POST', body: { clear: clearAfter } });
      if (clearAfter) setStrokes([]);
      refreshWidgets();
      Alert.alert(t('canvas.savedTitle'), t('canvas.savedBody'));
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }
  async function changePaper(bg) {
    setBackground(bg);
    apiFetch('/canvas', { method: 'PATCH', body: { background: bg } }).catch(() => {});
  }

  const TOOLS = [
    ['pen', 'brush'],
    ['eraser', 'remove-circle-outline'],
    ['eyedropper', 'color-filter-outline'],
    ...(zoom > 1 ? [['hand', 'hand-left-outline']] : []),
  ];

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        {TOOLS.map(([k, icon]) => (
          <Pressable key={k} onPress={() => setTool(k)} style={[styles.tool, tool === k && styles.toolActive]}>
            <Icon name={icon} size={18} chip={false} color={tool === k ? '#fff' : colors.text} />
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable onPress={undo} style={styles.tool}><Icon name="arrow-undo" size={18} chip={false} color={colors.text} /></Pressable>
        <Pressable onPress={clear} style={styles.tool}><Icon name="trash-outline" size={18} chip={false} color={colors.text} /></Pressable>
        <Pressable onPress={() => navigation.navigate('CanvasGallery')} style={styles.tool}><Icon name="images-outline" size={18} chip={false} color={colors.text} /></Pressable>
        <Pressable onPress={() => save(false)} style={[styles.tool, styles.toolActive]}><Icon name="bookmark" size={18} chip={false} color="#fff" /></Pressable>
      </View>

      <View style={styles.canvasWrap}>
        <View
          style={styles.canvas}
          onLayout={(e) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          {...responder.panHandlers}
        >
          <StrokeView strokes={strokes} background={background} width={layout.w} height={layout.h} viewport={{ ...pan, zoom }} extra={live} />
        </View>
        {tool === 'eyedropper' && <Text style={styles.hint}>{t('canvas.eyedropperHint')}</Text>}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.palette}>
        {PALETTE.map((c) => (
          <Pressable key={c} onPress={() => { setColor(c); if (tool !== 'pen') setTool('pen'); }}
            style={[styles.color, { backgroundColor: c }, color === c && tool === 'pen' && styles.colorActive]} />
        ))}
      </ScrollView>
      <View style={styles.row}>
        {SIZES.map((s) => (
          <Pressable key={s} onPress={() => setSize(s)} style={[styles.size, size === s && styles.sizeActive]}>
            <View style={{ width: 4 + s * 500, height: 4 + s * 500, borderRadius: 50, backgroundColor: tool === 'eraser' ? colors.textMuted : color }} />
          </Pressable>
        ))}
        <View style={{ width: spacing.sm }} />
        {ZOOMS.map((z) => <Chip key={z} label={`${z}×`} active={zoom === z} onPress={() => setZoomLevel(z)} style={{ paddingHorizontal: 10 }} />)}
      </View>
      <View style={[styles.row, { marginTop: spacing.xs }]}>
        <Text style={[font.muted, { marginRight: spacing.xs }]}>{t('canvas.paper')}</Text>
        {PAPERS.map((p) => (
          <Pressable key={p} onPress={() => changePaper(p)} style={[styles.paper, { backgroundColor: p }, background === p && styles.colorActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  tool: { width: 38, height: 38, borderRadius: radius.icon, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  toolActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  canvas: { aspectRatio: CANVAS_W / CANVAS_H, maxHeight: '100%', width: '100%', borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  hint: { ...font.muted, position: 'absolute', bottom: 8, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  palette: { gap: 8, paddingVertical: spacing.sm },
  color: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border },
  colorActive: { borderColor: colors.accent, borderWidth: 3, transform: [{ scale: 1.12 }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  size: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sizeActive: { borderColor: colors.accent, borderWidth: 2 },
  paper: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border },
});
