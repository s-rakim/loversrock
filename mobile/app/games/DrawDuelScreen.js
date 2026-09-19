import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, PanResponder, Alert, Pressable, ScrollView } from 'react-native';
import Svg from 'react-native-svg';
import { connectSocket } from '../../services/api';
import { spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';
import Icon from '../../components/Icon';
import { useTheme } from '../../components/ThemeContext';
import { StrokePath, PALETTE, WIDTHS, TOOLS } from '../../components/Doodle';

const WORD_BANK = ['SUNSET', 'GUITAR', 'ROBOT', 'PIZZA', 'OCTOPUS', 'CASTLE', 'ROCKET', 'UMBRELLA'];

// Real two-device gameplay: whichever device taps "I'll draw" becomes the
// drawer and strokes stream live, stroke-by-stroke, over the pair's
// Socket.io room (backend/src/sockets/index.js) to the other device, which
// renders them as they arrive and guesses via text.
export default function DrawDuelScreen() {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [role, setRole] = useState(null); // 'drawer' | 'guesser'
  const [strokes, setStrokes] = useState([]);
  const [wordLength, setWordLength] = useState(null);
  const [guess, setGuess] = useState('');
  const [status, setStatus] = useState(null); // null | 'correct'
  const [color, setColor] = useState('#FF5C8D');
  const [width, setWidth] = useState(6);
  const [tool, setTool] = useState('pen');
  // PanResponder is built once, so it needs a ref to see the current role
  // rather than the one it closed over on first render.
  const roleRef = useRef(null);
  roleRef.current = role;
  const secretWord = useRef(null);
  const currentStroke = useRef([]);
  const socketRef = useRef(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    connectSocket().then((socket) => {
      socketRef.current = socket;
      socket.on('drawduel:started', ({ wordLength: len }) => {
        setRole('guesser');
        setWordLength(len);
        setStrokes([]);
        setStatus(null);
      });
      socket.on('drawduel:stroke', ({ stroke }) => setStrokes((prev) => [...prev, stroke]));
      socket.on('drawduel:clear', () => setStrokes([]));
      socket.on('drawduel:guess', ({ text }) => {
        if (secretWord.current && text.trim().toLowerCase() === secretWord.current.toLowerCase()) {
          socketRef.current.emit('drawduel:correct', {});
          setStatus('correct');
        }
      });
      socket.on('drawduel:correct', () => setStatus('correct'));
    });
    return () => {
      ['drawduel:started', 'drawduel:stroke', 'drawduel:clear', 'drawduel:guess', 'drawduel:correct'].forEach((e) =>
        socketRef.current?.off(e)
      );
    };
  }, []);

  function startDrawing() {
    const word = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
    secretWord.current = word;
    setRole('drawer');
    setStrokes([]);
    setStatus(null);
    socketRef.current?.emit('drawduel:start', { wordLength: word.length });
  }

  // Same stroke format as the canvas, so the guessing phone renders a neon
  // squiggle as a neon squiggle. PanResponder is built once and would
  // otherwise capture the first render's tool forever, hence the ref.
  const styleRef = useRef({ color: '#FF5C8D', width: 6, tool: 'pen' });
  styleRef.current = { color, width, tool };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => roleRef.current === 'drawer',
      onMoveShouldSetPanResponder: () => roleRef.current === 'drawer',
      onPanResponderGrant: (evt) => {
        currentStroke.current = [{ x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY }];
      },
      onPanResponderMove: (evt) => {
        currentStroke.current = [...currentStroke.current, { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY }];
        forceRender((n) => n + 1);
      },
      onPanResponderRelease: () => {
        if (currentStroke.current.length > 1) {
          const stroke = { points: currentStroke.current, ...styleRef.current };
          setStrokes((prev) => [...prev, stroke]);
          socketRef.current?.emit('drawduel:stroke', { stroke });
        }
        currentStroke.current = [];
      },
    })
  ).current;

  function clearCanvas() {
    setStrokes([]);
    socketRef.current?.emit('drawduel:clear', {});
  }

  function submitGuess() {
    if (!guess.trim()) return;
    socketRef.current?.emit('drawduel:guess', { text: guess.trim() });
    setGuess('');
  }

  if (!role) {
    return (
      <View style={styles.centered}>
        <FadeInUp>
          <Text style={[font.body, { textAlign: 'center', marginBottom: spacing.lg }]}>
            Tap "I'll draw" to start a round, or just wait — if your partner starts drawing first, you'll
            automatically switch to guessing.
          </Text>
          <MorphButton onPress={startDrawing} style={styles.primaryButton}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>I'll draw</Text>
          </MorphButton>
        </FadeInUp>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={font.muted}>
        {role === 'drawer' ? `You're drawing: ${secretWord.current}` : `Guess the ${wordLength}-letter word`}
      </Text>

      <View style={styles.canvas} {...panResponder.panHandlers}>
        <Svg style={StyleSheet.absoluteFill}>
          {strokes.map((stroke, i) => (
            <StrokePath key={i} stroke={stroke} index={i} canvasColor={colors.surface} />
          ))}
          {currentStroke.current.length > 1 && (
            <StrokePath
              stroke={{ points: currentStroke.current, color, width, tool }}
              index={strokes.length}
              canvasColor={colors.surface}
            />
          )}
        </Svg>
      </View>

      {/* Only the drawer gets tools; the guesser gets a clean board. */}
      {role === 'drawer' && (
        <View style={styles.drawTools}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {PALETTE.slice(0, 10).map((swatch) => (
              <Pressable key={swatch} onPress={() => setColor(swatch)}>
                <View
                  style={[
                    styles.miniSwatch,
                    { backgroundColor: swatch },
                    color === swatch && styles.miniSwatchActive,
                  ]}
                />
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }}>
            {TOOLS.filter((t) => t.id !== 'eraser').map((t) => (
              <Pressable key={t.id} onPress={() => setTool(t.id)}>
                <View style={[styles.miniTool, tool === t.id && styles.miniToolActive]}>
                  <Icon name={t.icon} chip={false} size={16} color={tool === t.id ? '#fff' : colors.text} />
                </View>
              </Pressable>
            ))}
            {WIDTHS.map((w) => (
              <Pressable key={w} onPress={() => setWidth(w)}>
                <View style={[styles.miniTool, width === w && styles.miniToolActive]}>
                  <View style={{
                    width: Math.min(w, 16), height: Math.min(w, 16), borderRadius: 8,
                    backgroundColor: width === w ? '#fff' : colors.text,
                  }} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {status === 'correct' && (
        <View style={styles.correctRow}>
          <Icon name="sparkles" color={colors.gold} size={16} />
          <Text style={{ color: colors.success, fontWeight: '700' }}>Guessed correctly!</Text>
        </View>
      )}

      {role === 'drawer' ? (
        <MorphButton onPress={clearCanvas} style={styles.secondaryButton}>
          <Text style={font.body}>Clear canvas</Text>
        </MorphButton>
      ) : (
        <View style={styles.guessRow}>
          <TextInput
            placeholder="Your guess…"
            placeholderTextColor={colors.textMuted}
            value={guess}
            onChangeText={setGuess}
            onSubmitEditing={submitGuess}
            style={styles.input}
          />
          <MorphButton onPress={submitGuess} style={styles.primaryButtonSmall}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Guess</Text>
          </MorphButton>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  centered: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  canvas: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginVertical: spacing.md },
  drawTools: {
    marginTop: spacing.sm, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  miniSwatch: {
    width: 28, height: 28, borderRadius: 14, marginRight: 6,
    borderWidth: 2, borderColor: colors.border,
  },
  miniSwatchActive: { borderColor: colors.accent, borderWidth: 3 },
  miniTool: {
    width: 32, height: 32, borderRadius: 16, marginRight: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  miniToolActive: { backgroundColor: colors.accent },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, alignSelf: 'center' },
  primaryButtonSmall: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  secondaryButton: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center' },
  guessRow: { flexDirection: 'row', gap: spacing.sm },
  correctRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border },
});
