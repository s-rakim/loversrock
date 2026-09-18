import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import { getAccessToken } from './services/api';
import { colors } from './theme';

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
import FourInARowScreen from './app/games/FourInARowScreen';
import AnagramsScreen from './app/games/AnagramsScreen';
import LoveGolfScreen from './app/games/LoveGolfScreen';
import DrawDuelScreen from './app/games/DrawDuelScreen';
import WhatYouSayingScreen from './app/games/WhatYouSayingScreen';
import PerfectPairScreen from './app/games/PerfectPairScreen';
import LoveLettersScreen from './app/games/LoveLettersScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border },
};

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

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
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator initialRouteName={hasToken ? 'Home' : 'Login'} screenOptions={screenOptions}>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Pairing" component={PairingScreen} options={{ title: 'Pair up' }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="DailyPrompt" component={DailyPromptScreen} options={{ title: "Today's Prompt" }} />
        <Stack.Screen name="Quiz" component={QuizScreen} options={{ title: 'Daily Quiz' }} />
        <Stack.Screen name="DeckDetail" component={DeckDetailScreen} options={{ title: 'Deck' }} />
        <Stack.Screen name="Memories" component={MemoriesScreen} options={{ title: 'Memories' }} />
        <Stack.Screen name="BucketList" component={BucketListScreen} options={{ title: 'Bucket List' }} />
        <Stack.Screen name="DateIdeas" component={DateIdeasScreen} options={{ title: 'Date Ideas' }} />
        <Stack.Screen name="Countdown" component={CountdownScreen} options={{ title: 'Countdowns' }} />
        <Stack.Screen name="Messages" component={MessagesScreen} options={{ title: 'Messages' }} />
        <Stack.Screen name="Canvas" component={CanvasScreen} options={{ title: 'Draw' }} />
        <Stack.Screen name="ThumbKiss" component={ThumbKissScreen} options={{ title: 'Thumb Kiss' }} />
        <Stack.Screen name="DistanceApart" component={DistanceApartScreen} options={{ title: 'Distance Apart' }} />
        <Stack.Screen name="Games" component={GamesScreen} options={{ title: 'Arcade' }} />
        <Stack.Screen name="FourInARow" component={FourInARowScreen} options={{ title: 'Four in a Row' }} />
        <Stack.Screen name="Anagrams" component={AnagramsScreen} options={{ title: 'Anagrams' }} />
        <Stack.Screen name="LoveGolf" component={LoveGolfScreen} options={{ title: 'Love Golf' }} />
        <Stack.Screen name="DrawDuel" component={DrawDuelScreen} options={{ title: 'Draw Duel' }} />
        <Stack.Screen name="WhatYouSaying" component={WhatYouSayingScreen} options={{ title: 'What You Saying' }} />
        <Stack.Screen name="PerfectPair" component={PerfectPairScreen} options={{ title: 'Perfect Pair' }} />
        <Stack.Screen name="LoveLetters" component={LoveLettersScreen} options={{ title: 'Love Letters' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
