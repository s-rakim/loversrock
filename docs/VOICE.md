# Voice messages

A walkie-talkie between the two phones. **Hold** the mic in the middle of the
nav bar to talk, **let go** to send, **slide up** to cancel. **Tap** it to see
every note you have sent each other.

On the other phone the note **plays out loud as it arrives** — app open,
app closed, screen locked.

## How a note travels

```
hold mic ─► expo-av records AAC/.m4a ─► POST /voice (base64)
                                           │
               ffmpeg voice effect (opt.) ◄┤
                                           ├─► stored in MinIO, row in voice_messages
                                           ├─► socket  voice:new      (phones with the app open)
                                           ├─► FCM     data-only, high priority (Android)
                                           │           notification        (iPhone)
                                           └─► AI connector (after replying): transcript,
                                               translation ─► socket voice:transcript
                                                             FCM voice_text (words in the notification)
```

On Android the push wakes `VoiceMessagingService`
(`mobile/native/android/voice/`), which sits in front of expo-notifications'
own FCM service and passes everything that is not a voice note straight back
to it. It starts `VoicePlaybackService`, a `mediaPlayback` foreground service,
which downloads the note and plays it — pausing any music, and resuming it
after.

The service has no login token (the app may not have run since boot), so the
audio link carries its own proof: `/voice/:id/audio?u=&e=&s=` is signed for
one note, one listener, one week.

### When it does NOT play out loud

On purpose, the phone's own "be quiet" settings win:

- the phone is on **silent or vibrate**, or **Do Not Disturb** is on
- you are **on a call**
- another app has the speaker and won't give it up
- **auto-play is off** (Voice messages ▸ When one arrives)

In each case the note waits in your notifications with a **Play** button, and
its words when the AI connector is on. Both switches — auto-play, and "even
on silent" — are at the top of the Voice messages screen.

### iPhone

iOS never lets an app that is not running play sound by itself. An iPhone
gets a normal notification and plays the note when it is opened; with the
app open, it plays straight away.

### OPPO / Samsung

These phones stop "unimportant" apps waking up, which stops the push from
reaching the player. See the battery settings at the end of
`docs/NOTIFICATIONS.md` — the same fix covers both.

## The AI connector (optional)

Set in `backend/.env`, then `docker compose up -d --force-recreate backend`.
Everything is optional; unset, voice notes work the same without words.

| Variable | What |
|---|---|
| `VOICE_AI_TRANSCRIBE_PROVIDER` | `openai`, `groq` or `custom` — any OpenAI-compatible `/audio/transcriptions` |
| `VOICE_AI_TRANSCRIBE_API_KEY` | that provider's key |
| `VOICE_AI_TRANSCRIBE_MODEL` | optional: `gpt-4o-mini-transcribe` (openai), `whisper-large-v3-turbo` (groq) by default |
| `VOICE_AI_TRANSCRIBE_BASE_URL` | only for `custom`, e.g. your own Whisper server |
| `VOICE_AI_TRANSLATE_PROVIDER` | `anthropic`, or `openai`/`gemini`/`groq`/`openrouter`/`mistral`/`deepseek`/`together`/`ollama`/`custom` |
| `VOICE_AI_TRANSLATE_API_KEY` | that provider's key |
| `VOICE_AI_TRANSLATE_MODEL` | optional for `anthropic` (`claude-opus-5`), required otherwise |
| `VOICE_AI_TRANSLATE_BASE_URL` | only for `custom`, or to override a preset |

Two providers because no single model does both: Claude translates but does
not take audio. With Claude, a request it declines is re-run on Anthropic's
recommended fallback model (`fallbacks: "default"`) rather than coming back
empty.

Each person picks **"Translate what I'm sent into"** on the Voice messages
screen; notes are then translated for them as they arrive. Any note can also
be translated on demand, and translations are cached per language.

Is it on? The Voice messages screen says so, or:

```powershell
docker compose logs backend | Select-String voice
```

## Voice effects

Chipmunk, Deep, Robot, Echo, Radio — picked on the Voice messages screen and
applied on the server with ffmpeg (installed in the backend image). No key.
The note is transcribed from the original recording, not the effect.

## Tests

```bash
npm run test:voice      # sending, signed links, Range requests, who can hear what
npm run test:voice-ai   # transcription + translation against a stand-in provider,
                        # and every effect on real audio (needs ffmpeg)
bash mobile/native/android/tools/typecheck.sh   # the Android player, against real android.jar
```
