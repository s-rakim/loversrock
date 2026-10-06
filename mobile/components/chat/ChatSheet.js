// A sheet that rises from the bottom of the chat: a message's menu (react,
// reply, copy, edit, pin, remind, delete), the attach menu, the send-later
// menu. Rows are { icon, label, onPress, danger, hint }.
import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import Icon from '../Icon';

export default function ChatSheet({ visible, title, header, rows = [], onClose }) {
  const { colors, font } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        {title ? <Text style={[font.muted, styles.title]} numberOfLines={2}>{title}</Text> : null}
        {header}
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          {rows.filter(Boolean).map((row) => (
            <Pressable
              key={row.label}
              onPress={() => { onClose(); setTimeout(row.onPress, 50); }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
              accessibilityRole="button"
            >
              <Icon name={row.icon} chip={false} size={20} color={row.danger ? colors.danger : colors.text} />
              <View style={{ flex: 1 }}>
                <Text style={[font.body, row.danger && { color: colors.danger }]}>{row.label}</Text>
                {row.hint ? <Text style={[font.muted, { fontSize: 12 }]}>{row.hint}</Text> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    borderTopLeftRadius: radius.lg || 20, borderTopRightRadius: radius.lg || 20,
    paddingTop: spacing.sm, paddingHorizontal: spacing.md,
    // A sheet that fills a tablet's width is a long way to reach across.
    width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  title: { textAlign: 'center', marginBottom: spacing.sm, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
});
