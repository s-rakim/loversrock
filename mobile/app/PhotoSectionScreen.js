// Photos: the camera, the wall of everything either of you has ever sent, and
// the thread.
//
// One section rather than three tabs, because they are one activity. You take
// a photo, you look at the ones you have, you say something about them — and
// the reference app this is modelled on puts exactly these three behind one
// button for the same reason.
//
// Lockets and memories were separate for no reason a person would recognise:
// both are a photo the two of you shared, differing only in whether it also
// landed on a home screen. The wall shows both, merged by date.
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PhotoWidgetScreen from './PhotoWidgetScreen';
import PhotoHistoryScreen from './PhotoHistoryScreen';
import MessagesScreen from './MessagesScreen';
import { withSectionBar } from '../components/SectionBar';
import { useTheme } from '../components/ThemeContext';

const Stack = createNativeStackNavigator();

const ITEMS = [
  { key: 'Wall', icon: 'grid', label: 'Memories' },
  { key: 'Camera', icon: 'home', label: 'Camera' },
  { key: 'Messages', icon: 'chatbubble', label: 'Chat' },
];

const Camera = withSectionBar(PhotoWidgetScreen, ITEMS, 'Camera');
const Wall = withSectionBar(PhotoHistoryScreen, ITEMS, 'Wall');
const Thread = withSectionBar(MessagesScreen, ITEMS, 'Messages');

export default function PhotoSectionScreen() {
  const { reduceMotion } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        // Sideways, because these are siblings rather than a drill-down —
        // the same reason the pill has no back arrow on it.
        animation: reduceMotion ? 'fade' : 'slide_from_right',
        animationDuration: 200,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Stack.Screen name="Camera" component={Camera} />
      <Stack.Screen name="Wall" component={Wall} />
      <Stack.Screen name="Messages" component={Thread} />
    </Stack.Navigator>
  );
}
