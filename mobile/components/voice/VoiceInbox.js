// Listens for voice notes while the app is open. Renders nothing.
//
// With the app closed, the push does all the work (native/android/voice/).
// With it open, the note ALSO arrives over the socket, usually first, and
// this hands it to the same native player — which plays it once, whichever of
// the two got there first. On a phone with no native player, this plays it
// itself. And it keeps the native side told where the server is, because that
// is what the push needs when the app is not around to ask.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { onSocketEvent } from '../../services/api';
import { audioUrl, configureNative, getNative, myUserId, receiveNatively } from '../../services/voice';
import { playNote } from './player';

export default function VoiceInbox() {
  useEffect(() => {
    configureNative();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') configureNative();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => onSocketEvent('voice:new', async (event) => {
    const me = await myUserId();
    if (!event?.voice || !me || event.recipientId !== me) return;
    // In the background the push handles it; a socket event arriving then
    // would only double up.
    if (AppState.currentState !== 'active') return;

    if (getNative()) {
      await configureNative();
      await receiveNatively({ id: event.voice.id, path: event.recipientPath, from: event.from });
      return;
    }
    playNote({ id: event.voice.id, url: audioUrl(event.recipientPath) }).catch(() => {});
  }), []);

  return null;
}
