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
  const { colors, reduceMotion } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'fade' : 'slide_from_right',
        animationDuration: 200,
        // Opaque, and this matters more than it looks. A transparent
        // content style works in the ROOT stack because the only thing
        // behind it is the lava lamp. In here, the thing behind is the
        // sibling screen you just came from — so a pushed screen drew
        // straight over the previous one, and tapping through the bar
        // looked like tapping a button that does nothing.
        //
        // The default wallpaper makes it worse rather than causing it:
        // Wallpaper's 'none' preset renders null on purpose, to let the
        // lava lamp through, so the thread had no backdrop of its own
        // either.
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Drawings" component={Drawings} />
      <Stack.Screen name="Arcade" component={Arcade} />
    </Stack.Navigator>
  );
}
