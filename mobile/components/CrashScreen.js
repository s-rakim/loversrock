// What you see instead of nothing.
//
// A JavaScript error thrown while rendering is answered by React unmounting
// the whole tree, and a release build has no red box — so the app either goes
// white or closes outright. Both look identical to a bad install, which is
// how a one-line mistake in App.js cost several rounds of "it does not open"
// with nothing to act on.
//
// An error boundary cannot prevent the failure. What it can do is put the
// message on the screen, where it can be read and repeated, rather than only
// in a logcat buffer nobody has a cable for.
//
// Deliberately plain: no theme, no context, no icons, no fonts. Everything
// this renders is a built-in, because a boundary that depends on the app's
// own systems will fail alongside them and show nothing at all.
import React from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform, PixelRatio,
} from 'react-native';
import { BUILD_STAMP } from '../buildInfo';
import { lineHeightFor } from '../theme';

// The leading still has to follow the phone's font setting, or this is the
// one screen that goes cramped when everything else breathes. It reads the
// OS scale directly rather than through ThemeContext: a boundary that needs
// the app's providers is a boundary that fails with them. theme.js is safe
// to import because it imports nothing itself — it is constants and pure
// functions, with no native module behind it.
const fontScale = (() => {
  try { return PixelRatio.getFontScale(); } catch { return 1; }
})();

export default class CrashScreen extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Still log it: with a cable attached this is what shows up in logcat,
    // and it carries the component stack that the screen truncates.
    console.error('[loversrock] render failed', error, info?.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.title}>loversrock hit an error</Text>
        <Text style={styles.subtitle}>
          This screen is here so the error can be read rather than guessed at.
        </Text>

        <ScrollView style={styles.box} contentContainerStyle={styles.boxInner}>
          <Text style={styles.label}>Error</Text>
          <Text style={styles.mono} selectable>
            {String(error?.name || 'Error')}: {String(error?.message || error)}
          </Text>

          {info?.componentStack ? (
            <>
              <Text style={styles.label}>Where</Text>
              <Text style={styles.mono} selectable>
                {info.componentStack.trim().split('\n').slice(0, 12).join('\n')}
              </Text>
            </>
          ) : null}

          {error?.stack ? (
            <>
              <Text style={styles.label}>Stack</Text>
              <Text style={styles.mono} selectable>
                {error.stack.split('\n').slice(0, 12).join('\n')}
              </Text>
            </>
          ) : null}

          <Text style={styles.label}>Build</Text>
          <Text style={styles.mono} selectable>{BUILD_STAMP}</Text>
        </ScrollView>

        {/* Retry rather than restart: a failure caused by one screen's data
            often clears on a second mount, and this saves killing the app to
            find out. */}
        <Pressable
          style={styles.button}
          onPress={() => this.setState({ error: null, info: null })}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>

        <Text style={styles.footnote}>
          The text above is selectable — long-press to copy it.
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14101a', padding: 20, paddingTop: 64 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#b9b0c4', fontSize: 13, marginTop: 6, marginBottom: 16 },
  box: { flex: 1, backgroundColor: '#1e1826', borderRadius: 16, borderWidth: 1, borderColor: '#332b3d' },
  boxInner: { padding: 14 },
  label: {
    color: '#e08aa4', fontSize: 11, fontWeight: '800',
    letterSpacing: 1, marginTop: 14, marginBottom: 4,
  },
  mono: {
    color: '#e8e2ee',
    fontSize: 12,
    lineHeight: lineHeightFor(12, fontScale, 1.5),
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  button: {
    marginTop: 16, backgroundColor: '#d9647f', borderRadius: 999,
    paddingVertical: 14, alignItems: 'center',
  },
  buttonText: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
  footnote: { color: '#7d7488', fontSize: 11, textAlign: 'center', marginTop: 10 },
});
