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

## Connectivity: private first, the internet if that does not connect

WebRTC needs the two phones to find a path to each other. A call tries in
two steps:

1. **Private.** Each phone offers only its Tailscale address, its home
   network address and the relay (when one is set up). Nobody outside the
   tailnet learns anything, and on a working tailnet this connects in about a
   second.
2. **The internet, if step 1 has not connected six seconds after the call is
   answered** (or as soon as ICE reports failure). The caller widens the call
   without hanging up: both phones ask a public STUN server (Google's) for
   their internet address and offer it to each other, which is how calls
   always connected before the private step existed. The other phone is the
   only one told; the STUN server sees the address the way any website does.

`GET /calls/config` serves the private servers (`iceServers`) and the
fallback separately (`fallbackStun`). In `backend/.env`:

```bash
STUN_FALLBACK=off                # never widen: Tailscale or the relay only
STUN_FALLBACK=stun:my.stun:3478  # widen, with your own STUN server
STUN_URLS=stun:...               # use STUN from the start instead
```

The case neither step solves is both phones behind symmetric NAT (some mobile
carriers, some corporate networks) with no working Tailscale path. That needs
a **TURN server**, which relays the media:

```bash
# backend/.env
TURN_URL=turn:your.turn.server:3478
TURN_USERNAME=user
TURN_PASSWORD=secret
```

`hasTurn` in the config response tells the client whether it has one. The
bundled `coturn` container is the other option (below); there are also
hosted ones.

### When a call cannot connect

The error under a failed call lists which networks each phone offered:

- **Tailscale:** an address on the tailnet (100.64.x.x to 100.127.x.x).
- **local network:** Wi-Fi or LAN.
- **internet:** the public address STUN found (only after the call widened).
- **relay:** the TURN server.

If both phones list **Tailscale**, they can reach each other over the tailnet
and no relay is needed. When one side has no Tailscale address, fix that
first:

- Turn Tailscale on for that phone.
- Check that loversrock is not in Tailscale's excluded apps.

A relay is the fallback when that is not possible. For the bundled coturn,
set `TURN_PUBLIC_IP` and `TURN_SECRET` in `docker/.env`.

A failed connection is widened to the internet (above), then given one plain
ICE restart by the caller. A call that has not connected 45 seconds after it
was answered is ended, with the networks each phone offered.

If the callee's app was closed when the call came in, the original offer went
nowhere. When the app opens (from the call notification, or just by being
brought to the front), it checks `GET /calls/current`. If it finds it is being
rung, it sends `call:want-offer`, and the caller sends its offer and
candidates again.

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

## Ringing

- **Calling out:** you hear the standard ringback trill. It used to be your
  own ringtone, because InCallManager's "default" ringback on Android is the
  phone's ringtone. It now uses `_DTMF_`, the network-style ringing tone.
- **Being called:** the phone rings with its ringtone, over and over, until
  you answer, decline, or the caller hangs up. The ringer is
  `native/android/voice/CallRinger.kt`. It posts the call on its own
  "Incoming calls (ringing)" channel, whose sound is the ringtone, and marks
  it insistent. It follows the ringer switch: silent stays silent, vibrate
  vibrates. The server sends it a data-only `call` push, which works with the
  app closed. If the caller gives up, a `call_end` push stops the ringing and
  leaves a missed call. With the app open, the socket starts the same ringer,
  so the push and the socket ring only once.
- **Which phones:** only phones whose app says it can ring (`can_ring` in
  `user_devices`, sent when the app registers for push) get the data-only
  call. Older builds and iPhones get the ordinary call notification as before.

If it still doesn't ring on ColorOS: in Settings → Apps → loversrock →
Notifications, allow "Incoming calls (ringing)" and give it sound. Also allow
the app to run in the background (Battery → the app).
