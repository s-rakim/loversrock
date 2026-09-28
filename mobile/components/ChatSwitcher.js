// The chats on the message board.
//
// The thread with your partner lives in this app. Fable is the group chat
// between the two of you and your AI agents, and it lives in its own project
// (collaboration-des-esprits), not here. So it is not a person and has no
// thread of its own: tapping it leaves the app for that project.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Alert } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';
import Icon from './Icon';

export const FABLE_CHAT = {
  name: 'Fable',
  blurb: 'You two and your AI agents',
  url: 'https://github.com/s-rakim/collaboration-des-esprits',
};

export default function ChatSwitcher({ partnerName }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const openFable = async () => {
    try {
      await Linking.openURL(FABLE_CHAT.url);
    } catch {
      Alert.alert(`Couldn't open ${FABLE_CHAT.name}`, FABLE_CHAT.url);
    }
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {/* The thread you are in. Not a button: you are already here. */}
      <View style={[styles.chip, styles.current]} accessibilityState={{ selected: true }}>
        <Icon name="heart" chip={false} size={14} color={colors.accent} />
        <Text style={[styles.name, { color: colors.accent }]}>{partnerName || 'Partner'}</Text>
      </View>

      <MorphButton
        onPress={openFable}
        style={styles.chip}
        accessibilityRole="link"
        accessibilityLabel={`${FABLE_CHAT.name}: ${FABLE_CHAT.blurb}. Opens outside the app.`}
      >
        <Icon name="people" chip={false} size={14} color={colors.text} />
        <View>
          <Text style={styles.name}>{FABLE_CHAT.name}</Text>
          <Text style={styles.blurb}>{FABLE_CHAT.blurb}</Text>
        </View>
        <Icon name="open-outline" chip={false} size={12} color={colors.textMuted} />
      </MorphButton>
    </ScrollView>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    row: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
      borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    current: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    name: { color: colors.text, fontWeight: '700', fontSize: 13 },
    blurb: { color: colors.textMuted, fontSize: 10, marginTop: -1 },
  });
