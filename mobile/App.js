import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
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
import * as Notifications from 'expo-notifications';
import { ensureChannels, routeForNotification } from './services/notifications';
import GlassTabBar from './components/GlassTabBar';

import LoginScreen from './app/LoginScreen';
import PairingScreen from './app/PairingScreen';
import HomeScreen from './app/HomeScreen';
import DailyPromptScreen from './app/DailyPromptScreen';
import QuizScreen from './app/QuizScreen';
import DeckDetailScreen from './app/DeckDetailScreen';
import MemoriesScreen from './app/MemoriesScreen';
import BucketListScreen from './app/BucketListScreen';
import DateIdeasScreen from './app/DateIdeasScreen';
import CountdownScreen from './app/CountdownScreen';
import MessagesScreen from './app/MessagesScreen';
import CanvasScreen from './app/CanvasScreen';
import ThumbKissScreen from './app/ThumbKissScreen';
import DistanceApartScreen from './app/DistanceApartScreen';
import PeriodTrackerScreen from './app/PeriodTrackerScreen';
import GamesScreen from './app/GamesScreen';
import SettingsScreen from './app/SettingsScreen';
import FourInARowScreen from './app/games/FourInARowScreen';
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
  const { colors, isDark } = useTheme();
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
    },
  };
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <GlassTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Games" component={GamesScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Memories" component={MemoriesScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
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
    const go = (response) => {
      const route = routeForNotification(response);
      if (route && navigationRef.isReady()) navigationRef.navigate(route.screen, route.params);
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
        <ActivityIndicator color={colors.accentPink} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <LavaLamp />
      <NavigationContainer ref={navigationRef} theme={navTheme}>
          <StatusBar style={statusBarStyle} />
          <Stack.Navigator initialRouteName={hasToken ? 'MainTabs' : 'Login'} screenOptions={screenOptions}>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Pairing" component={PairingScreen} options={{ title: 'Pair up' }} />
            <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="DailyPrompt" component={DailyPromptScreen} options={{ title: "Today's Prompt" }} />
            <Stack.Screen name="Quiz" component={QuizScreen} options={{ title: 'Daily Quiz' }} />
            <Stack.Screen name="DeckDetail" component={DeckDetailScreen} options={{ title: 'Deck' }} />
            <Stack.Screen name="BucketList" component={BucketListScreen} options={{ title: 'Bucket List' }} />
            <Stack.Screen name="DateIdeas" component={DateIdeasScreen} options={{ title: 'Date Ideas' }} />
            <Stack.Screen name="Countdown" component={CountdownScreen} options={{ title: 'Countdowns' }} />
            <Stack.Screen name="Canvas" component={CanvasScreen} options={{ title: 'Draw' }} />
            <Stack.Screen name="ThumbKiss" component={ThumbKissScreen} options={{ title: 'Thumb Kiss' }} />
            <Stack.Screen name="DistanceApart" component={DistanceApartScreen} options={{ title: 'Distance Apart' }} />
            <Stack.Screen name="PeriodTracker" component={PeriodTrackerScreen} options={{ title: 'Cycle Tracker' }} />
            <Stack.Screen name="FourInARow" component={FourInARowScreen} options={{ title: 'Four in a Row' }} />
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
          <Root />
        </GlassProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
