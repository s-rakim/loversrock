import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Image } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { getAccessToken, loadApiUrl } from './services/api';
import { colors } from './theme';
import { GlassProvider } from './components/GlassContext';
import { ThemeProvider, useTheme } from './components/ThemeContext';
import LavaLamp from './components/LavaLamp';
import Mascot from './components/Mascot';
import { PAIR_ART } from './assets/mascot';
import * as Notifications from 'expo-notifications';
import { ensureChannels, routeForNotification } from './services/notifications';
import GlassTabBar from './components/GlassTabBar';
import { CallProvider, useCall } from './components/calls/CallContext';
import { fadeOnFocus } from './components/Motion';

import LoginScreen from './app/LoginScreen';
import PairingScreen from './app/PairingScreen';
import HomeScreen from './app/HomeScreen';
import DailyPromptScreen from './app/DailyPromptScreen';
import QuizScreen from './app/QuizScreen';
import DeckDetailScreen from './app/DeckDetailScreen';
import MemoriesScreen from './app/MemoriesScreen';
import BucketListScreen from './app/BucketListScreen';
import DateIdeasScreen from './app/DateIdeasScreen';
import SwipeDeckScreen from './app/SwipeDeckScreen';
import CheckinScreen from './app/CheckinScreen';
import CountdownScreen from './app/CountdownScreen';
import MessagesScreen from './app/MessagesScreen';
import CanvasScreen from './app/CanvasScreen';
import CanvasGalleryScreen from './app/CanvasGalleryScreen';
import ThumbKissScreen from './app/ThumbKissScreen';
import DistanceApartScreen from './app/DistanceApartScreen';
import PeriodTrackerScreen from './app/PeriodTrackerScreen';
import GamesScreen from './app/GamesScreen';
import SettingsScreen from './app/SettingsScreen';
import CallScreen from './app/CallScreen';
import DiagnosticsScreen from './app/DiagnosticsScreen';
import WardrobeScreen from './app/WardrobeScreen';
import PhotoWidgetScreen from './app/PhotoWidgetScreen';
import PhotoHistoryScreen from './app/PhotoHistoryScreen';
import WallpaperScreen from './app/WallpaperScreen';
import FourInARowScreen from './app/games/FourInARowScreen';
import TicTacToeScreen from './app/games/TicTacToeScreen';
import CheckersScreen from './app/games/CheckersScreen';
import ChessScreen from './app/games/ChessScreen';
import UnoReverseScreen from './app/games/UnoReverseScreen';
import BlockBlitzScreen from './app/games/BlockBlitzScreen';
import AnagramsScreen from './app/games/AnagramsScreen';
import LoveGolfScreen from './app/games/LoveGolfScreen';
import DrawDuelScreen from './app/games/DrawDuelScreen';
import WhatYouSayingScreen from './app/games/WhatYouSayingScreen';
import PerfectPairScreen from './app/games/PerfectPairScreen';
import LoveLettersScreen from './app/games/LoveLettersScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();


// The five primary destinations live behind the floating liquid-glass tab
// bar (components/GlassTabBar.js); everything else is pushed on top of it
// as a normal stack screen so the glass bar stays visible on the tabs but
// out of the way on deep/focused screens (quiz, canvas, games, etc).
// Navigation and the status bar have to be told about the theme separately —
// they render outside the React tree the tokens normally reach.
function useNavTheme() {
  const { colors, isDark, reduceMotion } = useTheme();
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    navTheme: {
      ...base,
      colors: {
        ...base.colors,
        background: 'transparent',
        card: colors.surface,
        text: colors.textPrimary,
        border: colors.cardBorder,
        primary: colors.accentPink,
      },
    },
    screenOptions: {
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.textPrimary,
      headerShadowVisible: false,
      contentStyle: { backgroundColor: 'transparent' },
      // Screen-to-screen motion, set once for the whole stack. react-native-screens
      // runs these on the UI thread, so they stay smooth while a screen is still
      // fetching. Anyone who asked the OS for reduced motion gets a plain fade.
      animation: reduceMotion ? 'fade' : 'slide_from_right',
      animationDuration: 260,
      gestureEnabled: true,
      // The lava lamp lives behind the navigator, so a transparent card during
      // the transition is what stops a grey flash between screens.
      freezeOnBlur: true,
    },
  };
}

function MainTabs() {
  return (
    // bottom-tabs v6 does not animate the scene change at all — it swaps the
    // view outright. fadeOnFocus() gives each tab its own entrance so the
    // switch glides; upgrading the navigator for its built-in animation would
    // be a much larger change than the effect is worth.
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      sceneContainerStyle={{ backgroundColor: 'transparent' }}
      tabBar={(props) => <GlassTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={fadeOnFocus(HomeScreen)} />
      {/* The quiz is the thing there is a new one of every day, and it was
          buried two taps deep behind a Home card. It gets its own tab. */}
      <Tab.Screen name="Quiz" component={fadeOnFocus(QuizScreen)} />
      <Tab.Screen name="Games" component={fadeOnFocus(GamesScreen)} />
      <Tab.Screen name="Messages" component={fadeOnFocus(MessagesScreen)} />
      <Tab.Screen name="Memories" component={fadeOnFocus(MemoriesScreen)} />
      <Tab.Screen name="Settings" component={fadeOnFocus(SettingsScreen)} />
    </Tab.Navigator>
  );
}

/**
 * Pushes the call screen the moment a call exists, whoever started it.
 *
 * An incoming call must interrupt whatever is on screen — that is the one
 * notification in this app allowed to. It renders nothing itself; it only
 * watches the call state, which is why it sits inside the navigator.
 */
function CallPresenter({ navigationRef }) {
  const { call } = useCall();
  const shown = useRef(false);

  useEffect(() => {
    const live = call.phase === 'ringing-in' || call.phase === 'ringing-out'
      || call.phase === 'connecting' || call.phase === 'connected';
    if (live && !shown.current && navigationRef.isReady()) {
      shown.current = true;
      navigationRef.navigate('Call');
    }
    if (!live) shown.current = false;
  }, [call.phase, navigationRef]);

  return null;
}

function Root() {
  const { navTheme, screenOptions } = useNavTheme();
  const { colors, statusBarStyle } = useTheme();
  const navigationRef = useNavigationContainerRef();

  // Channels must exist before the first notification arrives, not before the
  // first one is *sent* — Android drops anything aimed at a missing channel.
  useEffect(() => {
    ensureChannels();
  }, []);

  // Two paths into the app: tapped while running, and tapped from cold. The
  // second returns the response that launched the app, which is easy to miss.
  useEffect(() => {
    // Routes that live inside the bottom tabs rather than the root stack.
    // navigate('Quiz') from the root would otherwise have nothing to match.
    const TAB_ROUTES = new Set(['Home', 'Quiz', 'Games', 'Messages', 'Memories', 'Settings']);

    const go = (response) => {
      const route = routeForNotification(response);
      if (!route || !navigationRef.isReady()) return;
      if (TAB_ROUTES.has(route.screen)) {
        navigationRef.navigate('MainTabs', { screen: route.screen, params: route.params });
      } else {
        navigationRef.navigate(route.screen, route.params);
      }
    };

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) go(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [navigationRef]);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    // The saved server address has to be restored before anything can make a
    // request, so this runs ahead of the first render that can fetch.
    loadApiUrl()
      .then(getAccessToken)
      .then((token) => setHasToken(Boolean(token)))
      .catch(() => setHasToken(false))
      .finally(() => setCheckingAuth(false));
  }, []);

  if (checkingAuth) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <LavaLamp />
        {/* The mascot holds the loading moment rather than a bare spinner.
            Neutral here on purpose — the partner's mood is not known until
            after sign-in, and guessing one would be a lie for half a second.

            The pair artwork, if there is any, is shown as supplied: the two
            of you leaning on each other is a single picture, and there is no
            arrangement of two cut-outs that reproduces it. */}
        {PAIR_ART
          ? <Image source={PAIR_ART} style={{ width: 240, height: 240 }} resizeMode="contain" />
          : <Mascot size={140} />}
        <ActivityIndicator color={colors.accentPink} size="large" style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <LavaLamp />
      <NavigationContainer ref={navigationRef} theme={navTheme}>
          <StatusBar style={statusBarStyle} />
          <CallPresenter navigationRef={navigationRef} />
          <Stack.Navigator initialRouteName={hasToken ? 'MainTabs' : 'Login'} screenOptions={screenOptions}>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Pairing" component={PairingScreen} options={{ title: 'Pair up' }} />
            <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="DailyPrompt" component={DailyPromptScreen} options={{ title: "Today's Prompt" }} />
            <Stack.Screen name="DeckDetail" component={DeckDetailScreen} options={{ title: 'Deck' }} />
            <Stack.Screen name="BucketList" component={BucketListScreen} options={{ title: 'Bucket List' }} />
            <Stack.Screen name="DateIdeas" component={DateIdeasScreen} options={{ title: 'Date Ideas' }} />
            {/* The deck is how ideas actually get chosen; the list is where
                the ones you both said yes to end up. */}
            <Stack.Screen name="SwipeDeck" component={SwipeDeckScreen} options={{ title: 'Swipe' }} />
            <Stack.Screen name="Checkin" component={CheckinScreen} options={{ title: 'Monthly Check-In' }} />
            <Stack.Screen name="Countdown" component={CountdownScreen} options={{ title: 'Countdowns' }} />
            {/* The shelf, and the canvas itself. The gallery is the entry
                point of the two: you arrive wanting to see what is there far
                more often than with a blank drawing already in mind. */}
            <Stack.Screen name="CanvasGallery" component={CanvasGalleryScreen} options={{ title: 'Drawings' }} />
            <Stack.Screen name="Canvas" component={CanvasScreen} options={{ title: 'Draw' }} />
            {/* The locket, as its own section: a camera screen and the wall of
                everything sent. headerShown false on the camera because the
                camera IS the screen — a title bar over it is just a bar. */}
            <Stack.Screen name="PhotoWidget" component={PhotoWidgetScreen} options={{ headerShown: false }} />
            <Stack.Screen name="PhotoHistory" component={PhotoHistoryScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Wallpaper" component={WallpaperScreen} options={{ title: 'Chat Wallpaper' }} />
            <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: 'Diagnostics' }} />
            <Stack.Screen name="Wardrobe" component={WardrobeScreen} options={{ title: 'Your character' }} />
            <Stack.Screen name="ThumbKiss" component={ThumbKissScreen} options={{ title: 'Thumb Kiss' }} />
            <Stack.Screen name="DistanceApart" component={DistanceApartScreen} options={{ title: 'Distance Apart' }} />
            <Stack.Screen name="PeriodTracker" component={PeriodTrackerScreen} options={{ title: 'Cycle Tracker' }} />
            <Stack.Screen
              name="Call"
              component={CallScreen}
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
                animation: 'slide_from_bottom',
                // Not swipe-dismissible: leaving a call is a deliberate act,
                // and an accidental back-swipe mid-call would be maddening.
                gestureEnabled: false,
              }}
            />
            <Stack.Screen name="FourInARow" component={FourInARowScreen} options={{ title: 'Four in a Row' }} />
            <Stack.Screen name="TicTacToe" component={TicTacToeScreen} options={{ title: 'Tic Tac Toe' }} />
            <Stack.Screen name="Checkers" component={CheckersScreen} options={{ title: 'Checkers' }} />
            <Stack.Screen name="Chess" component={ChessScreen} options={{ title: 'Chess' }} />
            <Stack.Screen name="UnoReverse" component={UnoReverseScreen} options={{ title: 'Uno Reverse' }} />
            <Stack.Screen name="BlockBlitz" component={BlockBlitzScreen} options={{ title: 'Block Blitz' }} />
            <Stack.Screen name="Anagrams" component={AnagramsScreen} options={{ title: 'Anagrams' }} />
            <Stack.Screen name="LoveGolf" component={LoveGolfScreen} options={{ title: 'Love Golf' }} />
            <Stack.Screen name="DrawDuel" component={DrawDuelScreen} options={{ title: 'Draw Duel' }} />
            <Stack.Screen name="WhatYouSaying" component={WhatYouSayingScreen} options={{ title: 'What You Saying' }} />
            <Stack.Screen name="PerfectPair" component={PerfectPairScreen} options={{ title: 'Perfect Pair' }} />
            <Stack.Screen name="LoveLetters" component={LoveLettersScreen} options={{ title: 'Love Letters' }} />
          </Stack.Navigator>
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <GlassProvider>
          <CallProvider>
            <Root />
          </CallProvider>
        </GlassProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
