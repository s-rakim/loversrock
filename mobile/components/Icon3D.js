// Colourful 3D icons: the look of the home screen.
//
// The line glyphs in Icon.js are right for small UI (a tab bar, a send
// button). A feature someone taps to open wants something with weight and
// colour, so those get these: Microsoft's Fluent 3D emoji (MIT, see
// assets/icons3d/LICENSE.md), bundled as images so they look the same on
// every phone rather than on whatever emoji font it has.
import React from 'react';
import { Image } from 'react-native';
import Icon from './Icon';

export const ICONS_3D = {
  airplane: require('../assets/icons3d/airplane.png'),
  bolt: require('../assets/icons3d/bolt.png'),
  book: require('../assets/icons3d/book.png'),
  bulb: require('../assets/icons3d/bulb.png'),
  calendar: require('../assets/icons3d/calendar.png'),
  camera: require('../assets/icons3d/camera.png'),
  cards: require('../assets/icons3d/cards.png'),
  chart: require('../assets/icons3d/chart.png'),
  chat: require('../assets/icons3d/chat.png'),
  check: require('../assets/icons3d/check.png'),
  circle: require('../assets/icons3d/circle.png'),
  cross: require('../assets/icons3d/cross.png'),
  die: require('../assets/icons3d/die.png'),
  droplet: require('../assets/icons3d/droplet.png'),
  fire: require('../assets/icons3d/fire.png'),
  flag: require('../assets/icons3d/flag.png'),
  game: require('../assets/icons3d/game.png'),
  gift: require('../assets/icons3d/gift.png'),
  golf: require('../assets/icons3d/golf.png'),
  grin: require('../assets/icons3d/grin.png'),
  handshake: require('../assets/icons3d/handshake.png'),
  heart: require('../assets/icons3d/heart.png'),
  herb: require('../assets/icons3d/herb.png'),
  hourglass: require('../assets/icons3d/hourglass.png'),
  hug: require('../assets/icons3d/hug.png'),
  joystick: require('../assets/icons3d/joystick.png'),
  kiss: require('../assets/icons3d/kiss.png'),
  letters: require('../assets/icons3d/letters.png'),
  link: require('../assets/icons3d/link.png'),
  love_letter: require('../assets/icons3d/love_letter.png'),
  memo: require('../assets/icons3d/memo.png'),
  microphone: require('../assets/icons3d/microphone.png'),
  money: require('../assets/icons3d/money.png'),
  mood: require('../assets/icons3d/mood.png'),
  moon: require('../assets/icons3d/moon.png'),
  palette: require('../assets/icons3d/palette.png'),
  phone: require('../assets/icons3d/phone.png'),
  picture: require('../assets/icons3d/picture.png'),
  pin: require('../assets/icons3d/pin.png'),
  planet: require('../assets/icons3d/planet.png'),
  puzzle: require('../assets/icons3d/puzzle.png'),
  question: require('../assets/icons3d/question.png'),
  quiz: require('../assets/icons3d/quiz.png'),
  ribbonheart: require('../assets/icons3d/ribbonheart.png'),
  robot: require('../assets/icons3d/robot.png'),
  rocket: require('../assets/icons3d/rocket.png'),
  shuffle: require('../assets/icons3d/shuffle.png'),
  sparkles: require('../assets/icons3d/sparkles.png'),
  star: require('../assets/icons3d/star.png'),
  sun: require('../assets/icons3d/sun.png'),
  trophy: require('../assets/icons3d/trophy.png'),
  video: require('../assets/icons3d/video.png'),
};

/**
 * Decks and games name their icon the old way, with an Ionicons name from
 * the server ("flame-outline"). These are the 3D equivalents; anything not
 * listed falls back to the line glyph rather than showing nothing.
 */
export const FROM_GLYPH = {
  'help-circle': 'question', flame: 'fire', people: 'hug', chatbubbles: 'chat', flag: 'flag',
  moon: 'moon', flash: 'bolt', planet: 'planet', shuffle: 'shuffle', 'heart-circle': 'ribbonheart',
  'hand-left': 'handshake', cash: 'money', 'trending-up': 'chart', happy: 'grin', book: 'book',
  leaf: 'herb', water: 'droplet', sunny: 'sun', camera: 'camera', rocket: 'rocket', star: 'star',
  airplane: 'airplane', trophy: 'trophy', heart: 'heart', gift: 'gift', sparkles: 'sparkles',
  calendar: 'calendar', close: 'cross', grid: 'puzzle', ellipse: 'circle', layers: 'cards',
  apps: 'joystick', text: 'letters', 'chatbox-ellipses': 'chat', link: 'link', albums: 'cards',
  golf: 'golf', brush: 'palette',
};

/** The 3D key for a name that is either one already or an Ionicons name. */
export function resolve3D(name) {
  if (!name) return null;
  if (ICONS_3D[name]) return name;
  const base = String(name).replace(/-(outline|sharp)$/, '');
  return FROM_GLYPH[base] || null;
}

export default function Icon3D({ name, size = 40, style }) {
  const key = resolve3D(name);
  if (!key) return <Icon name={name} chip={false} size={Math.round(size * 0.6)} style={style} />;
  return (
    <Image
      source={ICONS_3D[key]}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
