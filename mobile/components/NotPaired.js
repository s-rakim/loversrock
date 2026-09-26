// What a screen shows when there is nobody on the other end yet.
//
// Most of this app is two people, so before pairing the server refuses most
// requests with 403 "Not currently paired". Screens were surfacing that
// through Alert.alert('Error', err.message), which puts a modal dialog
// titled "Error" over the app for something that is not an error: it is the
// state everybody is in before they pair, and it has an obvious next step.
//
// So: say it plainly, and offer the step.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from './Icon';
import { MorphButton } from './Motion';
import { spacing, radius } from '../theme';
import { useTheme } from './ThemeContext';

export default function NotPaired({ navigation, what = 'This' }) {
  const { colors, font } = useTheme();

  return (
    <View style={styles.root}>
      <Icon name="heart-half-outline" chip chipSize={56} />
      <Text style={[font.h2, styles.title]}>{what} needs the two of you</Text>
      <Text style={[font.muted, styles.body]}>
        Pair with your partner and this fills up on its own.
      </Text>
      {navigation ? (
        <MorphButton
          onPress={() => navigation.navigate('Pairing')}
          style={[styles.button, { backgroundColor: colors.accent }]}
        >
          <Text style={styles.buttonText}>Pair up</Text>
        </MorphButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  title: { textAlign: 'center', marginTop: spacing.sm },
  body: { textAlign: 'center' },
  button: {
    marginTop: spacing.md,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
