// Play: the drawings and the arcade.
//
// Both are "we are doing something together for fun", and neither on its own
// justified a tab next to the things people open every day. Together they do.
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CanvasGalleryScreen from './CanvasGalleryScreen';
import GamesScreen from './GamesScreen';
import { withSectionBar } from '../components/SectionBar';
import { useTheme } from '../components/ThemeContext';

const Stack = createNativeStackNavigator();

const ITEMS = [
  { key: 'Drawings', icon: 'brush', label: 'Drawings' },
  { key: 'Arcade', icon: 'game-controller', label: 'Arcade' },
];

const Drawings = withSectionBar(CanvasGalleryScreen, ITEMS, 'Drawings');
const Arcade = withSectionBar(GamesScreen, ITEMS, 'Arcade');

export default function PlaySectionScreen() {
  const { reduceMotion } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'fade' : 'slide_from_right',
        animationDuration: 200,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Stack.Screen name="Drawings" component={Drawings} />
      <Stack.Screen name="Arcade" component={Arcade} />
    </Stack.Navigator>
  );
}
