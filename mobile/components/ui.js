// Small building blocks shared by the newer screens so they all keep the
// same card-first look: soft background, big rounded cards, one obvious
// action. Built on the existing theme + Motion kit.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from './Motion';
import Icon from './Icon';
import StickerField from './Stickers';

export function Screen({ children, scroll = true, sticker = 'minimal', padBottom = spacing.xl * 2, style, refreshControl }) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={[{ padding: spacing.lg, paddingBottom: padBottom }, style]} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: spacing.lg }, style]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {sticker ? <StickerField variant={sticker} /> : null}
      {body}
    </View>
  );
}

export function Card({ children, style, onPress, delay, tint }) {
  const content = <View style={[styles.card, tint ? { backgroundColor: tint, borderColor: 'transparent' } : null, style]}>{children}</View>;
  const wrapped = onPress ? <MorphButton onPress={onPress}>{content}</MorphButton> : content;
  return delay !== undefined ? <FadeInUp delay={delay}>{wrapped}</FadeInUp> : wrapped;
}

export function Button({ title, onPress, icon, kind = 'primary', disabled, style, small }) {
  const primary = kind === 'primary';
  const danger = kind === 'danger';
  return (
    <MorphButton onPress={disabled ? undefined : onPress} disabled={disabled} style={[
      styles.button,
      small && styles.buttonSmall,
      primary ? { backgroundColor: colors.accent } : danger ? { backgroundColor: '#FDE3E6' } : { backgroundColor: colors.surfaceAlt },
      disabled && { opacity: 0.5 },
      style,
    ]}>
      {icon ? <Icon name={icon} chip={false} size={small ? 14 : 17} color={primary ? '#fff' : danger ? colors.danger : colors.text} /> : null}
      <Text style={[styles.buttonText, small && { fontSize: 13 }, { color: primary ? '#fff' : danger ? colors.danger : colors.text }]}>{title}</Text>
    </MorphButton>
  );
}

export function Chip({ label, active, onPress, icon, style }) {
  return (
    <MorphButton onPress={onPress} style={[styles.chip, active && styles.chipActive, style]}>
      {icon ? <Icon name={icon} chip={false} size={14} color={active ? '#fff' : colors.text} /> : null}
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </MorphButton>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={font.h2}>{children}</Text>
      {right}
    </View>
  );
}

export function Empty({ icon = 'sparkles-outline', text }) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} chip chipSize={44} />
      <Text style={[font.muted, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function Pill({ icon, text, color = colors.gold, style }) {
  return (
    <View style={[styles.pill, style]}>
      {icon ? <Icon name={icon} size={14} chip={false} color={color} /> : null}
      <Text style={{ fontWeight: '700', color: colors.text }}>{text}</Text>
    </View>
  );
}

export const ui = StyleSheet.create({
  input: {
    backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, fontSize: 15,
  },
  bigQuestion: { fontSize: 24, fontWeight: '800', color: colors.text, lineHeight: 31 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderRadius: radius.pill, paddingVertical: spacing.sm + 4, paddingHorizontal: spacing.lg,
  },
  buttonSmall: { paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.md },
  buttonText: { fontWeight: '700', fontSize: 15 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border,
  },
});
