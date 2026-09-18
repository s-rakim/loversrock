import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { getAccessToken } from './services/api';
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

  useEffect(() => {
    getAccessToken()
      .then((token) => setHasToken(Boolean(token)))
      .finally(() => setCheckingAuth(false));
  }, []);

  if (checkingAuth) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <GlassProvider>
        <NavigationContainer theme={navTheme}>
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
            <Stack.Screen name="FourInARow" component={FourInARowScreen} options={{ title: 'Four in a Row' }} />
            <Stack.Screen name="Anagrams" component={AnagramsScreen} options={{ title: 'Anagrams' }} />
            <Stack.Screen name="LoveGolf" component={LoveGolfScreen} options={{ title: 'Love Golf' }} />
            <Stack.Screen name="DrawDuel" component={DrawDuelScreen} options={{ title: 'Draw Duel' }} />
            <Stack.Screen name="WhatYouSaying" component={WhatYouSayingScreen} options={{ title: 'What You Saying' }} />
            <Stack.Screen name="PerfectPair" component={PerfectPairScreen} options={{ title: 'Perfect Pair' }} />
            <Stack.Screen name="LoveLetters" component={LoveLettersScreen} options={{ title: 'Love Letters' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </GlassProvider>
    </SafeAreaProvider>
  );
}
