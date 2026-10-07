// A screen's title with its 3D icon beside it: the same icon as the tile that
// opened it, so every screen carries the look of the home screen.
import React from 'react';
import { View, Text } from 'react-native';
import Icon3D from './Icon3D';

/** Screen name → 3D icon. A screen not listed keeps a plain title. */
export const HEADER_ICONS = {
  Pairing: 'two_hearts',
  DailyPrompt: 'chat',
  DeckDetail: 'cards',
  BucketList: 'check',
  DateIdeas: 'bulb',
  SwipeDeck: 'love_letter',
  Checkin: 'clipboard',
  Feed: 'book',
  Achievements: 'trophy',
  Countdown: 'hourglass',
  Canvas: 'palette',
  Wallpaper: 'picture',
  Diagnostics: 'wrench',
  Wardrobe: 'tshirt',
  Fable: 'robot',
  FableSetup: 'robot',
  WidgetLook: 'sparkles',
  ThumbKiss: 'kiss',
  DistanceApart: 'pin',
  VoiceNotes: 'microphone',
  FourInARow: 'yellow_circle',
  TicTacToe: 'cross',
  Checkers: 'circle',
  Chess: 'chess',
  UnoReverse: 'arrows',
  BlockBlitz: 'bricks',
  Anagrams: 'letters',
  LoveGolf: 'golf',
  DrawDuel: 'palette',
  WhatYouSaying: 'speech_head',
  PerfectPair: 'two_hearts',
  LoveLetters: 'love_letter',
};

export default function HeaderTitle({ icon, children, tintColor }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon3D name={icon} size={26} />
      <Text style={{ color: tintColor, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{children}</Text>
    </View>
  );
}
