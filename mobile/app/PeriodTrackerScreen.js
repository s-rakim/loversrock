// The cycle tracker is a stack of its own, nested inside the app's root
// stack, so every screen in it shares one CycleProvider — the log sheets are
// pushed on top of the tracker rather than on top of the app, and they read
// the same already-fetched month instead of each re-fetching it.
//
// Transitions are set here rather than per screen: the log sheets rise from
// the bottom like the reference app's sheets, the rest slide in from the
// right, and both are gesture-dismissible.
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../components/ThemeContext';
import { CycleProvider } from '../components/cycle/CycleContext';

import CycleHomeScreen from './cycle/CycleHomeScreen';
import DailyLogScreen from './cycle/DailyLogScreen';
import AddSymptomScreen from './cycle/AddSymptomScreen';
import AddMoodScreen from './cycle/AddMoodScreen';
import IntercourseScreen from './cycle/IntercourseScreen';
import CycleSharingScreen from './cycle/CycleSharingScreen';

const Stack = createNativeStackNavigator();

export default function PeriodTrackerScreen() {
  const { colors, reduceMotion } = useTheme();

  // A sheet that flies up is the wrong gesture for someone who asked the OS
  // for less movement — those users get a plain fade instead.
  const sheet = {
    presentation: 'containedModal',
    animation: reduceMotion ? 'fade' : 'slide_from_bottom',
    animationDuration: 260,
    gestureEnabled: true,
    gestureDirection: 'vertical',
    headerShown: false,
    contentStyle: { backgroundColor: colors.background },
  };

  return (
    <CycleProvider>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: reduceMotion ? 'fade' : 'slide_from_right',
          animationDuration: 240,
          gestureEnabled: true,
          // Opaque, for the reason the photo and play sections are: this is a
          // nested stack, so the thing behind a pushed screen is the sibling
          // you came from, not the lava lamp.
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="CycleHome" component={CycleHomeScreen} />
        <Stack.Screen name="CycleDailyLog" component={DailyLogScreen} options={sheet} />
        <Stack.Screen name="CycleAddSymptom" component={AddSymptomScreen} options={sheet} />
        <Stack.Screen name="CycleAddMood" component={AddMoodScreen} options={sheet} />
        <Stack.Screen name="CycleIntercourse" component={IntercourseScreen} options={sheet} />
        <Stack.Screen
          name="CycleSharing"
          component={CycleSharingScreen}
          options={{ headerShown: true, title: 'Partner sharing' }}
        />
      </Stack.Navigator>
    </CycleProvider>
  );
}
