// The header the reference app puts on every log sheet: a close cross on the
// left, the date in the middle, and a pink confirm tick on the right.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '../../theme';
import { useTheme } from '../ThemeContext';
import { MorphButton } from '../Motion';

export default function SheetHeader({ title, onClose, onConfirm, saving = false }) {
  const { colors, font } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.row}>
      <MorphButton onPress={onClose} style={styles.side}>
        <Ionicons name="close" size={24} color={colors.textPrimary} />
      </MorphButton>

      <Text style={font.h2} numberOfLines={1}>{title}</Text>

      <MorphButton onPress={onConfirm} disabled={saving} style={[styles.side, styles.confirm]}>
        {saving ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Ionicons name="checkmark" size={22} color="#fff" />
        )}
      </MorphButton>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
    },
    side: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
    confirm: { backgroundColor: colors.accentPink },
  });
