# Voice and video calls

## The shape of it

Calls are **peer to peer**. Once the two phones have found each other, audio
and video travel directly between them; the server is not in the media path
and could not record a call if it wanted to — there is no column for it.

What the server does:

1. **Records the call.** `call_sessions` holds who rang whom, when, how it
   ended and how long it lasted. The row is created *before* any signalling,
   so a missed call is still a recorded call even if the caller's phone dies.
2. **Rings the other phone.** A socket only reaches an app that is open, so
   `/calls/start` also sends an FCM push on the `calls` channel — the one
   channel at MAX importance, which is what lets it interrupt.
3. **Relays the handshake.** SDP offers, answers and ICE candidates go over
   the pair's socket room. They are relayed and never stored: an ICE
   candidate is worthless a second late and meaningless out of context.

```
  Caller                    Server                     Callee
    |  POST /calls/start      |                          |
    |------------------------>|  row + FCM push -------->|
    |  socket call:offer      |                          |
    |------------------------>|------------------------->|
    |                         |   POST /calls/:id/answer |
    |                         |<-------------------------|
    |  socket call:answer     |                          |
    |<------------------------|<-------------------------|
    |  socket call:ice  (both directions, trickled)      |
    |<===================== media =======================>|
    |        (direct, never through the server)          |
```

## Connectivity, and the one case that needs more

WebRTC needs the two devices to find a path to each other. `GET /calls/config`
serves Google's public STUN, which is enough whenever a direct path exists —
and for a couple on the same **Tailscale tailnet, that is the normal case**,
because Tailscale has already solved the NAT problem.

The case STUN cannot solve is both ends behind symmetric NAT (some mobile
carriers, some corporate networks). That needs a **TURN server**, which
relays the media. It is configured only if you have one:

```bash
# backend/.env
TURN_URL=turn:your.turn.server:3478
TURN_USERNAME=user
TURN_PASSWORD=secret
```

Without it, calls work in the common case and fail honestly in the uncommon
one, with a message that says what would fix it. `hasTurn` in the config
response tells the client which situation it is in. Running your own is a
`coturn` container; there are also hosted ones.

## Building it

`react-native-webrtc` is **native code**, so:

- It cannot run in Expo Go. You need a development build or an EAS build.
- `@config-plugins/react-native-webrtc` adds the permissions at prebuild
  time. Verified by running prebuild for real: `CAMERA`, `RECORD_AUDIO`,
  `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH` and `WAKE_LOCK` appear in the merged
  `AndroidManifest.xml`, and autolinking resolves `WebRTCModulePackage`.

```bash
cd mobile
eas build --profile preview --platform android --clear-cache
```

## Verified vs. unverified

**Tested against a live stack** — `backend/test/calls.mjs` (46 assertions):

- The call state machine, including the distinction the client cannot make
  for itself: a call that ends unanswered is **declined** if the callee hung
  up and **missed** if the caller gave up.
- The privacy boundary: someone outside the pair cannot start, answer, hang
  up, or read history, and cannot even open a socket.
- The signalling relay carrying a **complete WebRTC handshake** between two
  real sockets — offer, answer, three trickled ICE candidates in order,
  renegotiation, hangup — plus the assertion that a sender does not receive
  their own offer back, which would make the caller try to answer itself.
- `call:peer-gone` firing immediately when a socket drops, so the other end
  does not sit on a frozen frame for the tens of seconds ICE would take.

**Not verified, and cannot be here** — the media itself. Real audio and real
video between two real devices needs two real devices. What that pass still
has to shake out:

- Audio routing: earpiece vs. speaker vs. Bluetooth. `toggleSpeaker` covers
  the common Android case; a fuller answer is `react-native-incall-manager`,
  which was left out rather than added untested.
- Whether the call survives the screen locking, and whether Android's
  battery optimiser kills the connection in the background.
- Camera switching and orientation on specific hardware.
- Echo cancellation in a real room with two phones near each other.
- iOS needs CallKit for a proper incoming-call screen when the app is
  closed; today it gets a high-importance notification instead.
