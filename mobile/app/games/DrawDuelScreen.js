import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, PanResponder, Alert } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { connectSocket } from '../../services/api';
import { spacing, radius } from '../../theme';
import { MorphButton, FadeInUp } from '../../components/Motion';
import Icon from '../../components/Icon';
import { useTheme } from '../../components/ThemeContext';

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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => role === 'drawer',
      onMoveShouldSetPanResponder: () => role === 'drawer',
      onPanResponderGrant: (evt) => {
        currentStroke.current = [{ x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY }];
      },
      onPanResponderMove: (evt) => {
        currentStroke.current = [...currentStroke.current, { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY }];
        forceRender((n) => n + 1);
      },
      onPanResponderRelease: () => {
        if (currentStroke.current.length > 1) {
          setStrokes((prev) => [...prev, currentStroke.current]);
          socketRef.current?.emit('drawduel:stroke', { stroke: currentStroke.current });
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
        </Svg>
      </View>

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
  primaryButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, alignSelf: 'center' },
  primaryButtonSmall: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  secondaryButton: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: 'center' },
  guessRow: { flexDirection: 'row', gap: spacing.sm },
  correctRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: radius.pill, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border },
});
