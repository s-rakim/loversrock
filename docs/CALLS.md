# Voice and video calls

## The shape of it

Calls go **through a call server on the PC** when it is running, and
**peer to peer** when it is not.

### Through the call server (the default)

The `calls` container is [peer-calls](https://github.com/peer-calls/peer-calls)
(Apache-2.0, Go and pion), pinned to one commit and built from source by
`docker/calls/Dockerfile`. It is an SFU: each phone sends its audio and video
to the server, and the server forwards it to the other phone. It does not
record or store anything.

This is why it connects where peer to peer did not. Peer to peer needs the
two phones to reach *each other*, which carrier NAT, Tailscale on one side
only, or a relay that cannot carry media under Docker Desktop all break
("No path found"). Through the server, each phone only needs to reach the
PC, which it already does for everything else in the app.

```
  Caller                 Backend                  Callee
    |  POST /calls/start    |                        |
    |---------------------->|  row + FCM push ------>|  (rings, app closed or not)
    |  call:offer {sfu}     |----------------------->|
    |                       |  POST /calls/:id/answer|
    |  call:answer {sfu}    |<-----------------------|
    |<----------------------|                        |
    |                                                |
    |====== media =====> calls :4100 <===== media ====|
    |        both phones join room  call-<id>         |
```

The phone side is `mobile/components/calls/sfu.js`, which speaks
peer-calls' websocket protocol (`/ws/<room>/<clientId>`: `ready`, `users`,
the server's offer and the phone's answer, candidates both ways, `pubTrack`
and `subTrack`, `ping`, `hangUp`). The two patches in
`docker/calls/loversrock.patch` make the server advertise the PC's address
instead of the container's (`PEERCALLS_NAT1TO1_IPS`) and accept the app's
websocket, which has no browser origin (`PEERCALLS_WS_ORIGIN_PATTERNS`).

Setup, once, in `docker/.env`:

```bash
CALLS_PUBLIC_IP=        # the PC's Tailscale address: tailscale ip -4
```

Then `docker compose up -d --build` from `docker/`. Ports: 4100/tcp (the
websocket), 4101/tcp and 4110-4130/udp (media).

`GET /calls/config` returns `sfu: { url }` only when the backend can reach
the server's health check (`CALLS_SFU_HEALTH`). The websocket address is the
one the phone used to reach the backend, on port `CALLS_SFU_PORT`, or
`CALLS_SFU_URL` if that is set. With the server down, `sfu` is null and calls
fall back to peer to peer, as below.

Verified by `mobile/test/render.mjs` (the protocol, against a fake socket),
`backend/test/calls.mjs` (the config), and an end-to-end run of the patched
server with two Chromium pages: voice and video both connected in about 1.5
seconds, and a hang-up reached the other side. **Not yet verified on two
real phones.**

### What Nextcloud Talk's calls taught these

Nextcloud Talk for Android (GPL-3.0) was read for how it keeps calls up,
and the ideas were rewritten here; none of its code is in this repository,
which is MIT.

- **An ongoing-call service.** Since Android 11 an app may only use the
  microphone and camera while it is on screen, unless a foreground service
  of type `microphone` (`camera`) is running. Talk runs one for every call
  (CallForegroundService); without it, switching apps or locking the phone
  mid-call cut the microphone and the other phone heard silence.
  `native/android/voice/CallService.kt` does the same while a call is
  connecting or connected, and shows the call in the notification shade
  with Hang up (`loversrock://call?hangup=<id>`).
- **Reconnecting, not hanging up.** Talk puts a call into "Reconnecting…"
  when its connection drops and joins again. `SfuCall` (in
  `components/calls/sfu.js`) does that on the call server: a closed socket,
  a failed connection, or one disconnected for four seconds rejoins the
  room with the same microphone and camera, backing off, up to six times.
  The other phone shows "<name> is reconnecting…" until the media is back.
  Tested by killing the call server mid-call: both sides were back with
  audio 0.6 seconds after it restarted.
- **Mute and camera state, sent to the other phone** (`call:state`), so a
  muted partner reads "is muted" rather than silence, and a camera turned
  off shows their name rather than a frozen frame.
- **Reactions in the call** (`call:reaction`), floating up both screens.

### The call screen

Laid out like WhatsApp's: your chat wallpaper darkened behind it, minimise
top left, the name and timer in the middle, the chat top right, their
picture (or their video) in the middle, your camera in a tile you can drag,
and one pill of controls at the bottom (more, camera, sound, mute, end).
Tapping the screen slides the top bar and the controls away and back; on a
video call they go by themselves after five seconds.

- **Where the sound goes.** It used to be pinned: video calls forced the
  speakerphone, and "speaker off" forced the earpiece. While a route is
  forced, InCallManager never moves the call to Bluetooth earbuds or
  headphones, so the sound stayed on the phone. Now nothing is forced:
  InCallManager picks Bluetooth, then headphones, then the speaker (video) or
  earpiece (voice), and follows earbuds connected mid-call. With earbuds or
  headphones connected, the sound button opens WhatsApp's picker (Phone,
  Speaker, Bluetooth, Headphones).
- **Picture in picture** (`PictureInPicture.kt`, `plugins/withPictureInPicture.js`).
  Minimise, or leaving the app mid video call, shrinks the call into a small
  window over whatever you open next; the screen draws just their video (or
  their picture and the timer) at that size. A voice call minimises back into
  the app, with a green "Tap to return to the call" bar along the top.

### When calls still do not work

Settings, then **Diagnostics**, now tests calls from the phone:

- **Call server**: whether the backend offers it, and if not, why (not set
  up, the container not running, no address).
- **Call through the call server**: joins a room of its own and checks,
  step by step, that the phone reaches the websocket (TCP 4100) and that
  audio actually gets through (UDP 4110-4130 or TCP 4101). Each failure
  names the fix on the PC.

A call that fails phone to phone also says why the call server was not used.

### Peer to peer (the fallback)

Once the two phones have found each other, audio and video travel directly
between them; the server is not in the media path.

What the backend does in both modes:

1. **Records the call.** `call_sessions` holds who rang whom, when, how it
   ended and how long it lasted. The row is created *before* any signalling,
   so a missed call is still a recorded call even if the caller's phone dies.
2. **Rings the other phone.** A socket only reaches an app that is open, so
   `/calls/start` also sends an FCM push (see **Ringing**).
3. **Relays the handshake.** SDP offers, answers and ICE candidates go over
   the pair's socket room. They are relayed and never stored.

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

**Tested against a live stack** — `backend/test/calls.mjs` (58 assertions):

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

- **Answer and Decline on the notification.** On Android 12 and later the
  ringing notification is the system's own call style
  (`Notification.CallStyle.forIncomingCall`), with Answer and Decline
  buttons; older phones get plain buttons. Answer opens
  `loversrock://call?answer=<id>`, and the app answers the call as soon as it
  sees it ringing. Decline works without opening the app:
  `CallActionReceiver.kt` stops the ringing and posts to
  `/calls/:id/decline-from-notification` with the `declineToken` the push
  carried (an HMAC of that call id, good for declining that one call only).

### When the app is closed and it does not ring

The push arrives, but the phone decides whether it may wake the app.
Instagram and WhatsApp ring because the phone makers allow-list them;
loversrock has to be allowed by hand, once per phone. Settings → **Calls
when the app is closed** checks what the app can see (notifications, the
ringing channel, battery optimisation, full-screen calls on Android 14) with
a Fix button for each, and opens the maker's auto-launch screen.

On OPPO (ColorOS): turn on **Auto launch** for loversrock, and set Battery →
**Allow background activity**. Without these, swiping the app away stops it
hearing calls.
