// A poll in the chat. Tap an option to vote (again to take it back); on a
// poll that takes several answers, each tap adds or removes one. The tally
// shows once you have voted or the poll has ended, as in Nextcloud Talk, so
// the first answer is not steered by the other one's.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { spacing, radius } from '../../theme';
import { useTheme } from '../ThemeContext';
import Icon from '../Icon';
import { pollTally } from './chatModel';

export default function PollCard({ message, poll, sealed, meId, mine, onVote }) {
  const { colors, font } = useTheme();
  const ink = mine ? '#fff' : colors.text;
  const soft = mine ? 'rgba(255,255,255,0.78)' : colors.textMuted;
  const tally = pollTally(message, meId);

  if (!poll) {
    return <Text style={{ color: soft }}>{sealed ? "Can't open this poll — the keys don't match." : 'Decrypting…'}</Text>;
  }
  const showResults = tally.voted || tally.closed;
  const total = tally.options.reduce((n, o) => n + o.votes, 0) || 1;
  const mineNow = tally.options.map((o, i) => (o.mine ? i : -1)).filter((i) => i >= 0);

  const tap = (i) => {
    if (tally.closed) return;
    let next;
    if (tally.multi) next = mineNow.includes(i) ? mineNow.filter((c) => c !== i) : [...mineNow, i];
    else next = mineNow.includes(i) ? [] : [i];
    onVote(message, next);
  };

  return (
    <View>
      <View style={styles.head}>
        <Icon name="stats-chart" chip={false} size={14} color={soft} />
        <Text style={{ color: soft, fontSize: 12 }}>
          {tally.closed ? 'Poll ended' : tally.multi ? 'Poll · pick any' : 'Poll · pick one'}
        </Text>
      </View>
      <Text style={[font.body, { color: ink, fontWeight: '700', marginBottom: spacing.xs }]}>{poll.question}</Text>
      {(poll.options || []).slice(0, tally.options.length).map((label, i) => {
        const option = tally.options[i] || { votes: 0, mine: false };
        const share = Math.round((option.votes / total) * 100);
        return (
          <Pressable
            key={i}
            onPress={() => tap(i)}
            disabled={tally.closed}
            style={[styles.option, { borderColor: option.mine ? (mine ? '#fff' : colors.accent) : (mine ? 'rgba(255,255,255,0.4)' : colors.border) }]}
            accessibilityRole={tally.multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: option.mine, disabled: tally.closed }}
          >
            {showResults ? (
              <View style={[styles.bar, { width: `${share}%`, backgroundColor: mine ? 'rgba(255,255,255,0.22)' : colors.accentSoft || colors.surfaceAlt }]} />
            ) : null}
            <Icon
              name={option.mine ? (tally.multi ? 'checkbox' : 'radio-button-on') : (tally.multi ? 'square-outline' : 'radio-button-off')}
              chip={false}
              size={16}
              color={mine ? '#fff' : colors.accent}
            />
            <Text style={{ color: ink, flex: 1 }}>{label}</Text>
            {showResults ? <Text style={{ color: soft, fontSize: 12 }}>{option.votes} · {share}%</Text> : null}
          </Pressable>
        );
      })}
      <Text style={{ color: soft, fontSize: 11, marginTop: 2 }}>
        {tally.voters === 0 ? 'No votes yet' : tally.voters === 1 ? '1 of you has voted' : 'You have both voted'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6,
    marginTop: 4, overflow: 'hidden',
  },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
