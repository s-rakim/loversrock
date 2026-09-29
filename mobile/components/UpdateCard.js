// Settings → "Check for updates": checks, downloads and restarts into the
// newest version in one tap (services/appUpdates.js).
import React, { useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Icon3D from './Icon3D';
import { MorphButton } from './Motion';
import { useTheme } from './ThemeContext';
import { checkAndUpdate, currentVersion, explainUpdateError } from '../services/appUpdates';

export default function UpdateCard({ style }) {
  const { colors, font } = useTheme();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const version = currentVersion();

  const check = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await checkAndUpdate(setStatus);
    } catch (err) {
      setStatus(explainUpdateError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MorphButton onPress={check} disabled={busy} style={style} accessibilityLabel="Check for updates">
      <Icon3D name="rocket" size={34} />
      <View style={{ flex: 1 }}>
        <Text style={font.body}>Check for updates</Text>
        <Text style={font.muted}>{status || version.label}</Text>
      </View>
      {busy ? <ActivityIndicator color={colors.accent} /> : null}
    </MorphButton>
  );
}
