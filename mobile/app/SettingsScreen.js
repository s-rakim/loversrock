import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, Switch, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { useNavigation } from '@react-navigation/native';
import { apiFetch, clearTokens, disconnectSocket } from '../services/api';
import Constants from 'expo-constants';
import {
  clearWidgets,
  lockScreenStyle,
  refreshWidgets,
  setLockScreenEnabled,
  widgetsSupported,
} from '../services/widgetBridge';
import { useGlass } from '../components/GlassContext';
import Icon from '../components/Icon';
import StickerField from '../components/Stickers';
import ServerAddress from '../components/ServerAddress';
import NicknameCard from '../components/NicknameCard';
import MascotPicker from '../components/MascotPicker';
import RemindersCard from '../components/RemindersCard';
import { spacing, radius } from '../theme';
import { FadeInUp, MorphButton } from '../components/Motion';
import ConnectionCard from '../components/ConnectionCard';
import ColorPicker from '../components/ColorPicker';
import { useLanguage } from '../components/LanguageContext';
import {
  useTheme, THEME_PREFERENCES, ACCENTS, ACCENT_NAMES, BACKGROUND_SPEEDS, TEXT_SCALES,
  BLOB_PALETTES, BLOB_PALETTE_NAMES,
} from '../components/ThemeContext';

export default function SettingsScreen() {
  const {
    colors, font, preference, setPreference, motionPreference, setMotionPreference, reduceMotion,
    accentName, setAccent, backgroundIntensity, setBackgroundIntensity,
    backgroundSpeed, setBackgroundSpeed, backgroundDefinition, setBackgroundDefinition,
    textScale, setTextScale,
    customAccent, setCustomAccent, blobPalette, setBlobPalette, isDark,
  } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { intensity, setIntensity } = useGlass();
  const {
    preference: languagePreference, setPreference: setLanguagePreference, languages,
  } = useLanguage();
  const navigation = useNavigation();
  const [lockScreenOn, setLockScreenOn] = useState(false);
  const [cycleRole, setCycleRole] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/profile')
      .then((d) => { if (!cancelled) setCycleRole(d?.me?.cycleRole ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /**
   * Switch sides, or clear the choice so the tracker asks again.
   *
   * Confirmed rather than toggled straight through: for the person tracking,
   * switching to partner mode makes their own record read-only on their own
   * phone, which is a surprising thing to do by a mis-tap.
   */
  function changeCycleRole() {
    const next = cycleRole === 'owner' ? 'partner' : 'owner';
    const label = next === 'owner' ? 'track your own cycle' : 'see your partner’s shared view';
    Alert.alert(
      'Cycle tracker mode',
      `Switch so you ${label}? Nothing you have logged is deleted — this only changes which side of the tracker you see.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            try {
              await apiFetch('/profile/preferences', { method: 'PATCH', body: { cycleRole: next } });
              setCycleRole(next);
            } catch (err) {
              Alert.alert('Could not switch', err.message);
            }
          },
        },
      ]
    );
  }

  function toggleLockScreen(value) {
    setLockScreenOn(value);
    setLockScreenEnabled(value);
  }

  async function unlink() {
    Alert.alert('Unlink partner?', 'This clears your pairing. Your shared history is kept, never deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch('/auth/unlink', { method: 'POST' });
            navigation.reset({ index: 0, routes: [{ name: 'Pairing' }] });
          } catch (err) {
            Alert.alert('Could not unlink', err.message);
          }
        },
      },
    ]);
  }

  async function logout() {
    await clearWidgets();
    await clearTokens();
    disconnectSocket();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }

  return (
    <View style={styles.container}>
      <StickerField variant="minimal" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <FadeInUp>
        <View style={styles.headerRow}>
          <Icon name="settings-outline" chip chipSize={44} />
          <Text style={font.h1}>Settings</Text>
        </View>
      </FadeInUp>

      <FadeInUp delay={40}>
        <View style={styles.card}>
          <Text style={font.h2}>Appearance</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            System follows your phone and changes with it.
          </Text>
          <View style={styles.themeRow}>
            {THEME_PREFERENCES.map((option) => {
              const active = preference === option;
              return (
                <View key={option} style={{ flex: 1 }}>
                  <MorphButton
                    onPress={() => setPreference(option)}
                    style={[styles.themeOption, active && styles.themeOptionActive]}
                  >
                    <Icon
                      name={option === 'system' ? 'phone-portrait-outline' : option === 'light' ? 'sunny-outline' : 'moon-outline'}
                      size={16}
                      color={active ? colors.accentPink : colors.textSecondary}
                    />
                    <Text style={[styles.themeLabel, active && styles.themeLabelActive]}>
                      {option[0].toUpperCase() + option.slice(1)}
                    </Text>
                  </MorphButton>
                </View>
              );
            })}
          </View>

          <View style={styles.motionRow}>
            <View style={{ flex: 1 }}>
              <Text style={font.body}>Reduce motion</Text>
              <Text style={font.muted}>
                {motionPreference === 'system'
                  ? `Following your phone (currently ${reduceMotion ? 'on' : 'off'})`
                  : 'Background animation is ' + (reduceMotion ? 'paused' : 'playing')}
              </Text>
            </View>
            <Switch
              value={reduceMotion}
              onValueChange={(on) => setMotionPreference(on ? 'on' : 'off')}
              trackColor={{ true: colors.accentPink }}
            />
          </View>
        </View>
      </FadeInUp>

      <FadeInUp delay={45}>
        <View style={styles.card}>
          <Text style={font.h2}>Accent colour</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            Changes buttons, icons and highlights. Each one carries its own
            icon shade so the glyphs stay readable rather than washing out.
          </Text>
          <View style={styles.swatchRow}>
            {ACCENT_NAMES.map((id) => {
              const preset = ACCENTS[id];
              const active = !customAccent && accentName === id;
              return (
                <MorphButton
                  key={id}
                  onPress={() => { setCustomAccent(null); setAccent(id); }}
                  style={styles.swatchCell}
                >
                  <View style={[styles.swatch, { backgroundColor: preset.accent }, active && styles.swatchActive]}>
                    {active && <Icon name="checkmark" chip={false} size={18} color="#FFFFFF" />}
                  </View>
                  <Text style={[styles.swatchLabel, active && { color: colors.accent, fontWeight: '700' }]}>
                    {preset.label}
                  </Text>
                </MorphButton>
              );
            })}
          </View>

          <View style={styles.divider} />
          <Text style={font.h3}>Or any colour you like</Text>
          <Text style={[font.muted, { marginTop: 2, marginBottom: spacing.sm }]}>
            {customAccent
              ? `Using ${customAccent.toUpperCase()}.`
              : 'Pick one and it replaces the preset above.'}
          </Text>
          <ColorPicker
            value={customAccent}
            onChange={setCustomAccent}
            onClear={() => setCustomAccent(null)}
          />
        </View>
      </FadeInUp>

      <FadeInUp delay={46}>
        <View style={styles.card}>
          <Text style={font.h2}>Background colours</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            The blobs drifting behind every screen. Whole palettes rather than
            four separate colours — four hues chosen independently almost
            always come out as mud where they overlap.
          </Text>
          <View style={styles.swatchRow}>
            {BLOB_PALETTE_NAMES.map((id) => {
              const preset = BLOB_PALETTES[id];
              const active = blobPalette === id;
              const shown = isDark ? preset.dark : preset.light;
              return (
                <MorphButton key={id} onPress={() => setBlobPalette(id)} style={styles.swatchCell}>
                  <View style={[styles.paletteSwatch, active && styles.swatchActive]}>
                    {shown.map((c) => (
                      <View key={c} style={{ flex: 1, backgroundColor: c }} />
                    ))}
                  </View>
                  <Text style={[styles.swatchLabel, active && { color: colors.accent, fontWeight: '700' }]}>
                    {preset.label}
                  </Text>
                </MorphButton>
              );
            })}
          </View>
        </View>
      </FadeInUp>

      <FadeInUp delay={47}>
        <View style={styles.card}>
          <Text style={font.h2}>Live background</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            The drifting lava lamp behind every screen.
          </Text>

          <Text style={font.body}>Strength</Text>
          <Slider
            minimumValue={0.3}
            maximumValue={1}
            step={0.05}
            value={backgroundIntensity}
            onValueChange={setBackgroundIntensity}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
          />
          <Text style={[font.muted, { textAlign: 'right' }]}>
            {Math.round(backgroundIntensity * 100)}%
          </Text>
          {/* Deliberately caps at 100%. Every contrast measurement in the
              theme is taken at full strength, so a slider that went higher
              would be a setting that breaks the app's own readability. */}
          <Text style={[font.muted, { marginTop: 2, fontSize: 11 }]}>
            Turns down, not up — full strength is what the text colours are
            measured against.
          </Text>

          {/* The other half of "how strong is the background": strength is
              how much of it you see, this is where it stops. */}
          <Text style={[font.body, { marginTop: spacing.md }]}>Edges</Text>
          <Slider
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={backgroundDefinition}
            onValueChange={setBackgroundDefinition}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
          />
          <View style={styles.sliderEnds}>
            <Text style={[font.muted, { fontSize: 11 }]}>Blurred</Text>
            <Text style={[font.muted, { fontSize: 11 }]}>Defined</Text>
          </View>
          <Text style={[font.muted, { marginTop: 2, fontSize: 11 }]}>
            Where each blob stops. Left is smoke; right is lava with an actual
            edge to it.
          </Text>

          <Text style={[font.body, { marginTop: spacing.md }]}>Drift</Text>
          <View style={styles.segmentRow}>
            {Object.entries(BACKGROUND_SPEEDS).map(([id, spec]) => {
              const active = backgroundSpeed === id;
              return (
                <View key={id} style={{ flex: 1 }}>
                  <MorphButton
                    onPress={() => setBackgroundSpeed(id)}
                    style={[styles.segment, active && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{spec.label}</Text>
                  </MorphButton>
                </View>
              );
            })}
          </View>

          <View style={styles.motionRow}>
            <View style={{ flex: 1 }}>
              <Text style={font.body}>Chat wallpaper</Text>
              <Text style={font.muted}>Yours alone, behind your message thread.</Text>
            </View>
            <MorphButton onPress={() => navigation.navigate('Wallpaper')} style={styles.linkButton}>
              <Icon name="image-outline" chip={false} size={16} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: '600' }}>Choose</Text>
            </MorphButton>
          </View>
        </View>
      </FadeInUp>

      <FadeInUp delay={46}>
        <View style={styles.card}>
          <Text style={font.h2}>Language</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            Follows your phone unless you pick one. Your partner's phone has
            its own setting — you do not have to agree.
          </Text>
          <View style={styles.segmentRow}>
            {[{ code: 'system', native: 'Auto' }, ...languages].map((option) => {
              const active = languagePreference === option.code;
              return (
                <View key={option.code} style={{ flex: 1 }}>
                  <MorphButton
                    onPress={() => setLanguagePreference(option.code)}
                    style={[styles.segment, active && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                      {option.native}
                    </Text>
                  </MorphButton>
                </View>
              );
            })}
          </View>
        </View>
      </FadeInUp>

      <FadeInUp delay={48}>
        <View style={styles.card}>
          <Text style={font.h2}>Text size</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            On top of your phone's own font setting, which the app already
            follows.
          </Text>
          <View style={styles.segmentRow}>
            {TEXT_SCALES.map((option) => {
              const active = textScale === option.id;
              return (
                <View key={option.id} style={{ flex: 1 }}>
                  <MorphButton
                    onPress={() => setTextScale(option.id)}
                    style={[styles.segment, active && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{option.label}</Text>
                  </MorphButton>
                </View>
              );
            })}
          </View>
          <Text style={[font.body, { marginTop: spacing.md }]}>
            The quick brown fox jumps over the lazy dog.
          </Text>
          <Text style={font.muted}>And this is how the smaller print will look.</Text>
        </View>
      </FadeInUp>

      <FadeInUp delay={50}>
        <NicknameCard />
      </FadeInUp>

      <FadeInUp delay={55}>
        <RemindersCard />
      </FadeInUp>

      <FadeInUp delay={60}>
        <View style={styles.card}>
          <Text style={font.h2}>Bottom bar glass effect</Text>
          <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            Adjust how frosted vs. transparent the bottom navigation bar looks.
          </Text>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={intensity}
            onValueChange={setIntensity}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
          />
          <Text style={[font.muted, { textAlign: 'right' }]}>{Math.round(intensity)}%</Text>
        </View>
      </FadeInUp>

      <FadeInUp delay={90}>
        <View style={styles.card}>
          <Text style={font.h2}>Widgets</Text>
          {!widgetsSupported ? (
            <Text style={[font.muted, { marginTop: spacing.xs }]}>
              Home and lock screen widgets need a dev-client build — they can't run in Expo Go.
              See docs/WIDGETS.md.
            </Text>
          ) : (
            <>
              <Text style={[font.muted, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
                Long-press your home screen to add the loversrock widgets.
              </Text>

              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={font.body}>
                    {lockScreenStyle === 'widget' ? 'Lock screen widget' : 'Lock screen glance'}
                  </Text>
                  <Text style={font.muted}>
                    {lockScreenStyle === 'widget'
                      ? 'Add it from the lock screen customise menu.'
                      : 'Android has no lock screen widgets, so this shows as a quiet ongoing notification.'}
                  </Text>
                </View>
                {lockScreenStyle === 'notification' && (
                  <Switch
                    value={lockScreenOn}
                    onValueChange={toggleLockScreen}
                    trackColor={{ true: colors.accent }}
                  />
                )}
              </View>

              <MorphButton onPress={refreshWidgets} style={styles.refreshButton}>
                <Icon name="refresh-outline" chip={false} color={colors.accent} size={16} />
                <Text style={{ color: colors.accent, fontWeight: '600' }}>Refresh widgets now</Text>
              </MorphButton>
            </>
          )}
        </View>
      </FadeInUp>

      <FadeInUp delay={93}>
        <ConnectionCard />
      </FadeInUp>

      <FadeInUp delay={95}>
        <ServerAddress />
      </FadeInUp>

      <FadeInUp delay={97}>
        <View style={styles.card}>
          <Text style={font.h2}>About</Text>
          <View style={styles.aboutRow}>
            <Text style={font.muted}>Version</Text>
            <Text style={font.body}>{Constants.expoConfig?.version || '—'}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={font.muted}>Build</Text>
            <Text style={font.body}>
              {Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? '—'}
            </Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={font.muted}>Theme</Text>
            <Text style={font.body}>{preference} · {ACCENTS[accentName]?.label}</Text>
          </View>
        </View>
      </FadeInUp>

      <FadeInUp delay={52}>
        <MorphButton onPress={() => navigation.navigate('Wardrobe')} style={styles.actionRow}>
          <Icon name="shirt-outline" chip chipColor={colors.surfaceAlt} />
          <View style={{ flex: 1 }}>
            <Text style={font.body}>Your character</Text>
            <Text style={font.muted}>Skin, hair and a wardrobe. They see what you put on.</Text>
          </View>
        </MorphButton>
      </FadeInUp>

      <FadeInUp delay={60}>
        <MascotPicker />
      </FadeInUp>

      {/* The cycle tracker is the one asymmetric part of the app, so the
          choice made at sign-up has to be changeable without making a new
          account — somebody who picked wrong is otherwise stuck looking at
          a read-only screen forever. */}
      <FadeInUp delay={70}>
        <MorphButton onPress={changeCycleRole} style={styles.actionRow}>
          <Icon name="water-outline" chip chipColor={colors.surfaceAlt} />
          <View style={{ flex: 1 }}>
            <Text style={font.body}>Cycle tracker mode</Text>
            <Text style={font.muted}>
              {cycleRole === 'owner'
                ? 'You track your own cycle. Tap to switch to partner mode.'
                : cycleRole === 'partner'
                  ? 'You see what your partner shares. Tap to switch to tracking your own.'
                  : 'Not set yet. Tap to choose.'}
            </Text>
          </View>
        </MorphButton>
      </FadeInUp>

      <FadeInUp delay={98}>
        <MorphButton onPress={() => navigation.navigate('Diagnostics')} style={styles.actionRow}>
          <Icon name="pulse-outline" chip chipColor={colors.surfaceAlt} />
          <View style={{ flex: 1 }}>
            <Text style={font.body}>Diagnostics</Text>
            <Text style={font.muted}>Check what is working: server, live connection, photos, calls.</Text>
          </View>
        </MorphButton>
      </FadeInUp>

      <FadeInUp delay={100}>
        <MorphButton onPress={unlink} style={styles.actionRow}>
          <Icon name="person-remove-outline" chip chipColor={colors.surfaceAlt} color={colors.textMuted} />
          <Text style={font.body}>Unlink partner</Text>
        </MorphButton>
        <MorphButton onPress={logout} style={styles.actionRow}>
          <Icon name="log-out-outline" chip chipColor={colors.surfaceAlt} color={colors.danger} />
          <Text style={[font.body, { color: colors.danger }]}>Log out</Text>
        </MorphButton>
      </FadeInUp>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  // Bottom padding clears the floating glass tab bar.
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xl * 3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  themeRow: { flexDirection: 'row', gap: spacing.sm },
  motionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  themeOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  themeOptionActive: { backgroundColor: colors.tabBarActivePill, borderColor: colors.accentPink },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatchCell: { alignItems: 'center', width: 64 },
  swatch: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  swatchActive: { borderColor: colors.textPrimary },
  paletteSwatch: {
    width: 44, height: 44, borderRadius: 22, overflow: 'hidden',
    flexDirection: 'row', borderWidth: 3, borderColor: 'transparent',
  },
  divider: {
    height: 1, backgroundColor: colors.border,
    marginTop: spacing.lg, marginBottom: spacing.md,
  },
  swatchLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  sliderEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  segmentRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  segment: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  segmentActive: { backgroundColor: colors.tabBarActivePill, borderColor: colors.accentPink },
  segmentLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  segmentLabelActive: { color: colors.accentPink },
  linkButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.accentSoft, borderRadius: radius.pill,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  aboutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  themeLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  themeLabelActive: { color: colors.accentPink },
  refreshButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingVertical: spacing.sm, marginTop: spacing.md,
  },
});
