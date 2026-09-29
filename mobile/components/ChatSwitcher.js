// The chats on the message board: the thread with your partner, and Fable,
// the group chat between the two of you and an AI model (app/FableScreen.js).
// The chip for the chat you are in is highlighted; the other one switches.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';
import { MorphButton } from './Motion';
import Icon from './Icon';

export const FABLE_CHAT = {
  name: 'Fable',
  blurb: 'You two and an AI',
  screen: 'Fable',
};

export default function ChatSwitcher({ partnerName, current = 'partner', navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const chats = [
    { key: 'partner', screen: 'Messages', icon: 'heart', name: partnerName || 'Partner' },
    { key: 'fable', screen: FABLE_CHAT.screen, icon: 'people', name: FABLE_CHAT.name, blurb: FABLE_CHAT.blurb },
  ];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {chats.map((chat) => {
        const here = chat.key === current;
        const inner = (
          <>
            <Icon name={chat.icon} chip={false} size={14} color={here ? colors.accent : colors.text} />
            <View>
              <Text style={[styles.name, here && { color: colors.accent }]}>{chat.name}</Text>
              {chat.blurb ? <Text style={styles.blurb}>{chat.blurb}</Text> : null}
            </View>
          </>
        );
        // The chat you are in is not a button: you are already here.
        return here ? (
          <View key={chat.key} style={[styles.chip, styles.current]} accessibilityState={{ selected: true }}>
            {inner}
          </View>
        ) : (
          <MorphButton
            key={chat.key}
            onPress={() => navigation?.navigate(chat.screen)}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={chat.blurb ? `${chat.name}: ${chat.blurb}` : `Chat with ${chat.name}`}
          >
            {inner}
          </MorphButton>
        );
      })}
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
