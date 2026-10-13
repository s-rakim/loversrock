// The mood set people pick from, and the mascot emotion each one maps to.
// The mascot on MY phone shows my PARTNER's mood (and vice versa), so it's a
// little stand-in for them that lives in the app.
export const MOODS = [
  { emoji: '😊', key: 'happy', emotion: 'happy' },
  { emoji: '🥰', key: 'loved', emotion: 'love' },
  { emoji: '🤩', key: 'excited', emotion: 'excited' },
  { emoji: '😌', key: 'calm', emotion: 'calm' },
  { emoji: '🥺', key: 'missing', emotion: 'missing' },
  { emoji: '😴', key: 'tired', emotion: 'sleepy' },
  { emoji: '😢', key: 'sad', emotion: 'sad' },
  { emoji: '😤', key: 'grumpy', emotion: 'angry' },
  { emoji: '😰', key: 'stressed', emotion: 'anxious' },
  { emoji: '🤒', key: 'sick', emotion: 'sick' },
  { emoji: '😐', key: 'meh', emotion: 'neutral' },
];

export const EMOTIONS = ['neutral', 'happy', 'love', 'excited', 'calm', 'missing', 'sleepy', 'sad', 'angry', 'anxious', 'sick'];

export function emotionForMood(mood) {
  if (!mood?.emoji) return 'neutral';
  return MOODS.find((m) => m.emoji === mood.emoji)?.emotion || 'neutral';
}

export function moodForEmoji(emoji) {
  return MOODS.find((m) => m.emoji === emoji) || null;
}
