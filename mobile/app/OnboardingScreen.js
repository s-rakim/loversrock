// Candle-style onboarding: one big question per page, simple choices, the
// couple's characters keeping you company, and a "tailoring your journey"
// moment at the end. Answers are saved to /profile/onboarding; the birthday,
// anniversary and chosen character land on the real profile fields.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Easing, Alert, ScrollView } from 'react-native';
import { apiFetch } from '../services/api';
import { registerForPush } from '../services/push';
import { useCouple } from '../components/CoupleContext';
import { PRESETS } from '../components/avatar/wardrobe';
import Mascot from '../components/Mascot';
import { Button, Chip, ui } from '../components/ui';
import { ProgressDot } from '../components/Motion';
import StickerField from '../components/Stickers';
import { useI18n } from '../i18n';
import { colors, font, spacing } from '../theme';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export default function OnboardingScreen({ navigation }) {
  const { t } = useI18n();
  const { me, refresh, saveAvatar } = useCouple();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ goals: [] });
  const [tailoring, setTailoring] = useState(false);
  const set = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));
  const toggleGoal = (g) => setAnswers((a) => ({ ...a, goals: a.goals.includes(g) ? a.goals.filter((x) => x !== g) : [...a.goals, g] }));

  const STEPS = [
    {
      key: 'welcome',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.welcome', { name: me?.name || '' })}</Text>
          <Text style={[font.muted, { marginTop: spacing.sm }]}>{t('onboarding.welcomeBody')}</Text>
        </>
      ),
    },
    {
      key: 'character',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.character')}</Text>
          <View style={styles.characters}>
            {['her', 'him'].map((p) => (
              <View key={p} style={{ alignItems: 'center' }}>
                <Mascot avatar={PRESETS[p]} emotion={answers.character === p ? 'excited' : 'happy'} context="picker" onPress={() => set('character', p)} />
                <Chip label={t(`onboarding.character.${p}`)} active={answers.character === p} onPress={() => set('character', p)} />
              </View>
            ))}
          </View>
          <Text style={[font.muted, { textAlign: 'center' }]}>{t('onboarding.characterHint')}</Text>
        </>
      ),
      valid: () => Boolean(answers.character),
    },
    {
      key: 'birthday',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.birthday')}</Text>
          <TextInput style={[ui.input, styles.bigInput]} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted}
            value={answers.birthday || ''} onChangeText={(v) => set('birthday', v)} keyboardType="numbers-and-punctuation" />
        </>
      ),
      valid: () => !answers.birthday || isDate(answers.birthday),
    },
    {
      key: 'relationshipType',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.relationship')}</Text>
          <View style={[ui.wrap, { marginTop: spacing.md }]}>
            {['dating', 'engaged', 'married', 'long_distance', 'living_together', 'its_complicated'].map((k) => (
              <Chip key={k} label={t(`onboarding.rel.${k}`)} active={answers.relationshipType === k} onPress={() => set('relationshipType', k)} />
            ))}
          </View>
        </>
      ),
      valid: () => Boolean(answers.relationshipType),
    },
    {
      key: 'anniversary',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.anniversary')}</Text>
          <TextInput style={[ui.input, styles.bigInput]} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted}
            value={answers.anniversary || ''} onChangeText={(v) => set('anniversary', v)} keyboardType="numbers-and-punctuation" />
          <Text style={[font.muted, { marginTop: spacing.sm }]}>{t('onboarding.anniversaryHint')}</Text>
        </>
      ),
      valid: () => !answers.anniversary || isDate(answers.anniversary),
    },
    {
      key: 'goals',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.goals')}</Text>
          <View style={[ui.wrap, { marginTop: spacing.md }]}>
            {['communication', 'fun', 'intimacy', 'quality_time', 'memories', 'long_distance', 'growth', 'adventure'].map((g) => (
              <Chip key={g} label={t(`onboarding.goal.${g}`)} active={answers.goals.includes(g)} onPress={() => toggleGoal(g)} />
            ))}
          </View>
        </>
      ),
      valid: () => answers.goals.length > 0,
    },
    {
      key: 'dailyMinutes',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.time')}</Text>
          <View style={[ui.wrap, { marginTop: spacing.md }]}>
            {[2, 5, 10, 20].map((m) => (
              <Chip key={m} label={t('onboarding.minutes', { n: m })} active={answers.dailyMinutes === m} onPress={() => set('dailyMinutes', m)} />
            ))}
          </View>
        </>
      ),
      valid: () => Boolean(answers.dailyMinutes),
    },
    {
      key: 'foundVia',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.found')}</Text>
          <View style={[ui.wrap, { marginTop: spacing.md }]}>
            {['partner', 'friend', 'social', 'search', 'other'].map((k) => (
              <Chip key={k} label={t(`onboarding.found.${k}`)} active={answers.foundVia === k} onPress={() => set('foundVia', k)} />
            ))}
          </View>
        </>
      ),
    },
    {
      key: 'notifications',
      render: () => (
        <>
          <Text style={ui.bigQuestion}>{t('onboarding.notifications')}</Text>
          <Text style={[font.muted, { marginTop: spacing.sm }]}>{t('onboarding.notificationsBody')}</Text>
          <Button style={{ marginTop: spacing.lg }} icon="notifications" title={answers.notifications ? t('onboarding.notificationsOn') : t('onboarding.notificationsEnable')}
            kind={answers.notifications ? 'secondary' : 'primary'}
            onPress={async () => set('notifications', (await registerForPush()).granted)} />
        </>
      ),
    },
  ];

  const current = STEPS[step];
  const canNext = current.valid ? current.valid() : true;

  async function finish() {
    setTailoring(true);
    try {
      await apiFetch('/profile/onboarding', { method: 'POST', body: { answers } });
      if (answers.character) await saveAvatar(PRESETS[answers.character]);
      await refresh();
    } catch (err) {
      Alert.alert(t('common.error'), err.message);
    }
  }

  if (tailoring) return <Tailoring character={answers.character} onDone={() => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StickerField variant="home" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.dots}>{STEPS.map((s, i) => <ProgressDot key={s.key} active={i === step} />)}</View>
        {current.key !== 'character' && (
          <Mascot avatar={me?.avatar || PRESETS[answers.character || 'him']} emotion={['happy', 'excited', 'love', 'calm'][step % 4]} context="picker" style={{ marginBottom: spacing.lg }} />
        )}
        {current.render()}
      </ScrollView>
      <View style={styles.footer}>
        {step > 0 && <Button kind="secondary" title={t('common.back')} onPress={() => setStep(step - 1)} style={{ flex: 1 }} />}
        <Button
          title={step === STEPS.length - 1 ? t('onboarding.finish') : t('common.next')}
          disabled={!canNext}
          onPress={() => (step === STEPS.length - 1 ? finish() : setStep(step + 1))}
          style={{ flex: 2 }}
        />
      </View>
    </View>
  );
}

// "Tailoring your journey…" — a short personalisation moment before landing
// on Home, so the app feels made for this couple.
function Tailoring({ character, onDone }) {
  const { t } = useI18n();
  const progress = useRef(new Animated.Value(0)).current;
  const [line, setLine] = useState(0);
  const lines = ['onboarding.tailor1', 'onboarding.tailor2', 'onboarding.tailor3', 'onboarding.tailor4'];

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start(onDone);
    const id = setInterval(() => setLine((l) => Math.min(l + 1, lines.length - 1)), 1050);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={[styles.tailor, { backgroundColor: colors.bg }]}>
      <StickerField variant="celebrate" />
      <Mascot avatar={PRESETS[character === 'her' ? 'her' : 'him']} emotion="excited" context="hero" />
      <Text style={[font.h1, { textAlign: 'center', marginTop: spacing.lg }]}>{t('onboarding.tailorTitle')}</Text>
      <Text style={[font.muted, { textAlign: 'center', marginTop: spacing.sm }]}>{t(lines[line])}</Text>
      <View style={styles.bar}>
        <Animated.View style={[styles.barFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingTop: spacing.xl * 1.5, paddingBottom: 140 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: spacing.lg },
  characters: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: spacing.lg },
  bigInput: { fontSize: 22, marginTop: spacing.lg, textAlign: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.bg },
  tailor: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  bar: { height: 10, width: '80%', backgroundColor: colors.border, borderRadius: 5, marginTop: spacing.lg, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: colors.accent, borderRadius: 5 },
});
