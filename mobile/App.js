import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { getAccessToken, loadApiUrl } from './services/api';
import { colors } from './theme';
import { GlassProvider } from './components/GlassContext';
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
import WhosMoreLikelyScreen from './app/games/WhosMoreLikelyScreen';
import ChessScreen from './app/games/ChessScreen';
import FeedScreen from './app/FeedScreen';
import ProfileScreen from './app/ProfileScreen';
import WardrobeScreen from './app/WardrobeScreen';
import OnboardingScreen from './app/OnboardingScreen';
import ConnectScreen from './app/ConnectScreen';
import SparksScreen from './app/SparksScreen';
import AchievementsScreen from './app/AchievementsScreen';
import NotesScreen from './app/NotesScreen';
import SecretMessageScreen from './app/SecretMessageScreen';
import SharedCanvasScreen from './app/SharedCanvasScreen';
import CanvasGalleryScreen from './app/CanvasGalleryScreen';
import DailySnapScreen from './app/DailySnapScreen';
import DateDiscoverScreen from './app/DateDiscoverScreen';
import DatePlansScreen from './app/DatePlansScreen';
import CheckInScreen from './app/CheckInScreen';
import ChallengeScreen from './app/ChallengeScreen';
import TimelineScreen from './app/TimelineScreen';
import NotificationSettingsScreen from './app/NotificationSettingsScreen';
import { CoupleProvider, loadCachedCouple, characterFor } from './components/CoupleContext';
import { CoupleMascots } from './components/Mascot';
import { LanguageProvider, t } from './i18n';
import { apiFetch as apiFetchForLanguage } from './services/api';
import { refreshPushRegistration, routeNotificationTaps } from './services/push';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

// Widget taps open loversrock://<path> (see mobile/widgets/*).
const linking = {
  prefixes: ['loversrock://'],
  config: {
    screens: {
      MainTabs: { screens: { Home: 'home', Feed: 'feed', Messages: 'chat', Memories: 'memories' } },
      ThumbKiss: 'thumbkiss',
      SecretMessage: 'secret',
      DailySnap: 'snap',
      SharedCanvas: 'canvas',
      Notes: 'notes',
      DatePlans: 'dates',
      Countdown: 'countdowns',
      DailyPrompt: 'question',
      DistanceApart: 'distance',
      Profile: 'mood',
      Achievements: 'streak',
    },
  },
};

// The account's language preference follows the device's choice.
const syncLanguage = (language) => apiFetchForLanguage('/profile', { method: 'PATCH', body: { language } }).catch(() => {});

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border, primary: colors.accent },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

// The five primary destinations live behind the floating liquid-glass tab
// bar (components/GlassTabBar.js); everything else is pushed on top of it
// as a normal stack screen so the glass bar stays visible on the tabs but
// out of the way on deep/focused screens (quiz, canvas, games, etc).
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <GlassTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="Games" component={GamesScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
      <Tab.Screen name="Memories" component={MemoriesScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [cachedCouple, setCachedCouple] = useState(null);

  // The couple's characters greet you on the loading screen, straight from
  // the on-device cache so they appear before the network does.
  useEffect(() => {
    loadCachedCouple().then(setCachedCouple);
  }, []);

  useEffect(() => {
    if (!hasToken) return undefined;
    refreshPushRegistration();
    return routeNotificationTaps(navigationRef);
  }, [hasToken]);

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
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <CoupleMascots
          me={characterFor(cachedCouple?.me) || { emotion: 'happy' }}
          partner={characterFor(cachedCouple?.partner) || { emotion: 'happy', avatar: { preset: 'her' } }}
          context="loading"
          showLabels={false}
        />
        <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <LanguageProvider onChange={syncLanguage}>
      <CoupleProvider>
      <GlassProvider>
        <NavigationContainer theme={navTheme} ref={navigationRef} linking={linking}>
          <StatusBar style="dark" />
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
            <Stack.Screen name="WhosMoreLikely" component={WhosMoreLikelyScreen} options={{ title: t('screen.wml') }} />
            <Stack.Screen name="Chess" component={ChessScreen} options={{ title: t('screen.chess') }} />
            <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t('screen.profile') }} />
            <Stack.Screen name="Wardrobe" component={WardrobeScreen} options={{ title: t('screen.wardrobe') }} />
            <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: t('screen.connect') }} />
            <Stack.Screen name="Sparks" component={SparksScreen} options={{ title: t('screen.sparks') }} />
            <Stack.Screen name="Achievements" component={AchievementsScreen} options={{ title: t('screen.achievements') }} />
            <Stack.Screen name="Notes" component={NotesScreen} options={{ title: t('screen.notes') }} />
            <Stack.Screen name="SecretMessage" component={SecretMessageScreen} options={{ title: t('screen.secret') }} />
            <Stack.Screen name="SharedCanvas" component={SharedCanvasScreen} options={{ title: t('screen.canvas') }} />
            <Stack.Screen name="CanvasGallery" component={CanvasGalleryScreen} options={{ title: t('screen.gallery') }} />
            <Stack.Screen name="DailySnap" component={DailySnapScreen} options={{ title: t('screen.snap') }} />
            <Stack.Screen name="DateDiscover" component={DateDiscoverScreen} options={{ title: t('screen.dateDiscover') }} />
            <Stack.Screen name="DatePlans" component={DatePlansScreen} options={{ title: t('screen.datePlans') }} />
            <Stack.Screen name="CheckIn" component={CheckInScreen} options={{ title: t('screen.checkin') }} />
            <Stack.Screen name="Challenge" component={ChallengeScreen} options={{ title: t('screen.challenge') }} />
            <Stack.Screen name="Timeline" component={TimelineScreen} options={{ title: t('screen.timeline') }} />
            <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: t('screen.notifications') }} />
          </Stack.Navigator>
        </NavigationContainer>
      </GlassProvider>
      </CoupleProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
