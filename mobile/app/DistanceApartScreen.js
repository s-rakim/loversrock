import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert } from 'react-native';
import * as Location from 'expo-location';
import { apiFetch, connectSocket } from '../services/api';
import { colors, font, spacing, radius } from '../theme';
import { FadeInUp } from '../components/Motion';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';

const UPDATE_INTERVAL_MS = 30000;

export default function DistanceApartScreen() {
  const [enabled, setEnabled] = useState(false);
  const [distanceKm, setDistanceKm] = useState(null);
  const [reason, setReason] = useState(null);
  const watchRef = useRef(null);

  useEffect(() => {
    refreshDistance();
    let socketRef;
    connectSocket().then((socket) => {
      socketRef = socket;
      socket.on('location:update', refreshDistance);
    });
    return () => socketRef?.off('location:update');
  }, []);

  useEffect(() => {
    if (!enabled) {
      watchRef.current?.remove();
      watchRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location access is required to share your distance apart.');
        setEnabled(false);
        return;
      }
      if (cancelled) return;
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: UPDATE_INTERVAL_MS, distanceInterval: 100 },
        (loc) => {
          apiFetch('/location/update', {
            method: 'POST',
            body: { lat: loc.coords.latitude, lng: loc.coords.longitude },
          }).catch(() => {});
        }
      );
    })();
    return () => {
      cancelled = true;
      watchRef.current?.remove();
    };
  }, [enabled]);

  async function refreshDistance() {
    try {
      const data = await apiFetch('/location/distance');
      setDistanceKm(data.distanceKm);
      setReason(data.reason || null);
    } catch (err) {
      // ignore transient errors
    }
  }

  async function toggle(value) {
    try {
      await apiFetch('/location/enable', { method: 'POST', body: { enabled: value } });
      setEnabled(value);
      if (!value) {
        setDistanceKm(null);
        setReason('Location sharing is off');
      }
    } catch (err) {
      Alert.alert('Could not update sharing', err.message);
    }
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <FadeInUp>
        <View style={styles.toggleRow}>
          <View style={styles.toggleLabel}>
            <Icon name="navigate-outline" chip chipSize={36} />
            <Text style={font.h2}>Share my location</Text>
          </View>
          <Switch value={enabled} onValueChange={toggle} trackColor={{ true: colors.accent }} />
        </View>
        <Text style={[font.muted, { marginBottom: spacing.xl }]}>
          Off by default. Either of you can turn this off at any time — your last known position is cleared
          immediately when you do.
        </Text>

        <View style={styles.distanceCard}>
          {distanceKm !== null ? (
            <>
              <Text style={styles.distanceValue}>{distanceKm.toFixed(1)} km</Text>
              <Text style={font.muted}>apart right now</Text>
            </>
          ) : (
            <>
              <Icon name="heart-half-outline" chip chipSize={40} style={{ marginBottom: spacing.sm }} />
              <Text style={font.muted}>{reason || 'Turn on sharing to see how far apart you are.'}</Text>
            </>
          )}
        </View>
      </FadeInUp>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  toggleLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  distanceCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  distanceValue: { fontSize: 40, fontWeight: '800', color: colors.accent },
});
