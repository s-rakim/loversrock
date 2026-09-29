// Voice and video calling.
//
// One provider owns the RTCPeerConnection for the whole app, because a call
// has to survive navigating between screens — if the connection lived in the
// call screen, backing out of it would drop the call.
//
// How a call actually works here:
//
//   1. The caller POSTs /calls/start. That records the call and pushes a
//      notification, so a phone in a pocket rings even with the app closed.
//   2. The caller builds an offer and emits it over the socket.
//   3. The callee sees 'call:offer', shows the incoming screen, and on answer
//      POSTs /calls/:id/answer and emits its own SDP back.
//   4. Both trickle ICE candidates as they are discovered.
//   5. Media flows DIRECTLY between the phones. It never touches the server.
//
// The server relays the handshake and records who rang whom. It cannot see
// or hear the call, and there is nowhere for it to store one.
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Platform, AppState, PermissionsAndroid, Alert, NativeModules } from 'react-native';

/**
 * WebRTC, required rather than imported, for exactly the reason stated below
 * for InCallManager — and more urgently, because this one used to run at
 * module scope.
 *
 * `registerGlobals()` was called unguarded as the module loaded, which meant
 * a build where the native module did not initialise took the whole app down
 * on launch, before a single pixel: not "calls do not work", but "the app
 * does not open". Calling is one feature of many; it does not get to decide
 * whether the other twenty do.
 */
let WebRTC = null;
try {
  // eslint-disable-next-line global-require
  WebRTC = require('react-native-webrtc');
} catch {
  WebRTC = null;
}
const {
  RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, mediaDevices,
} = WebRTC || {};
import { apiFetch, connectSocket, getSocket, waitForSocket } from '../../services/api';
import {
  candidateLines, describePaths, isPrivateCandidate, privateSdp, scrubCandidate,
} from './paths';

/**
 * Audio routing, the ringtone, the proximity sensor and the wake lock.
 *
 * react-native-webrtc deliberately owns none of this — it has no speakerphone
 * API at all, which is why the speaker button used to toggle its own icon and
 * change nothing. Worse, Android routes call audio to the EARPIECE by
 * default, so a video call played out of the earpiece while you held the
 * phone at arm's length: audible only if you pressed it to your face, which
 * reads exactly like a call that does not work.
 *
 * Required at runtime rather than imported, so that a build where the native
 * module is missing degrades to "no speaker control" instead of a white
 * screen on launch.
 */
let InCallManager = null;
try {
  // eslint-disable-next-line global-require
  InCallManager = require('react-native-incall-manager').default;
} catch {
  InCallManager = null;
}
/**
 * Ringing on Android is the app's own native ringer
 * (native/android/voice/CallRinger.kt): your ringtone, repeating, following
 * the ringer switch — the same one the push starts when the app is closed,
 * so the socket and the push ring once between them. Builds from before it
 * existed fall back to InCallManager's ringtone.
 */
const nativeRinger = Platform.OS === 'android' && typeof NativeModules.VoiceNotes?.ringIncoming === 'function'
  ? NativeModules.VoiceNotes
  : null;

const audio = {
  start: (media) => { try { InCallManager?.start({ media, auto: true }); } catch { /* no native module */ } },
  stop: () => { try { InCallManager?.stop(); } catch { /* */ } },
  speaker: (on) => { try { InCallManager?.setForceSpeakerphoneOn(on); } catch { /* */ } },
  ring: (callId, from, kind) => {
    if (nativeRinger) {
      nativeRinger.ringIncoming(String(callId), from || 'Your partner', kind || 'voice').catch(() => {});
      return;
    }
    try { InCallManager?.startRingtone('_DEFAULT_'); } catch { /* */ }
  },
  stopRing: () => {
    nativeRinger?.stopRinging(null).catch(() => {});
    try { InCallManager?.stopRingtone(); } catch { /* */ }
  },
  // '_DTMF_', not '_DEFAULT_'. InCallManager's "default" ringback on Android
  // is the phone's own RINGTONE, so making a call rang your phone as if you
  // were being called. '_DTMF_' is the network-style ringback trill
  // (ToneGenerator's ringing tone), which is what a caller should hear.
  ringback: () => { try { InCallManager?.startRingback('_DTMF_'); } catch { /* */ } },
  stopRingback: () => { try { InCallManager?.stopRingback(); } catch { /* */ } },
  screenOn: (on) => { try { InCallManager?.setKeepScreenOn(on); } catch { /* */ } },
};
export const hasAudioRouting = () => InCallManager !== null;

// react-native-webrtc needs its globals installed once, before any peer
// connection is built — but never at the cost of the app starting at all.
try {
  WebRTC?.registerGlobals?.();
} catch {
  WebRTC = null;
}

/** Whether this build can place a call at all. */
export const hasCalling = () => WebRTC !== null;

const CallContext = createContext(null);

// 'idle' | 'ringing-out' | 'ringing-in' | 'connecting' | 'connected' | 'ended'
const IDLE = { phase: 'idle' };

export function CallProvider({ children }) {
  const [call, setCall] = useState(IDLE);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [error, setError] = useState(null);
  // What ICE is actually doing. "Connecting" with no detail is the state this
  // call spent most of its life in, and it told nobody anything.
  const [iceState, setIceState] = useState(null);
  const [relayed, setRelayed] = useState(false);
  const restarted = useRef(false);

  const pc = useRef(null);
  const localStreamRef = useRef(null);
  // ICE candidates can arrive before the remote description is set, and
  // addIceCandidate throws if it does. They are queued and flushed after.
  const pendingCandidates = useRef([]);
  const callIdRef = useRef(null);
  // For the ringing notification's "Hobi is calling". Fetched once; a call
  // arriving before it lands just says "Your partner".
  const partnerNameRef = useRef(null);
  useEffect(() => {
    apiFetch('/profile')
      .then((d) => { partnerNameRef.current = d?.partner?.displayName || null; })
      .catch(() => {});
  }, []);
  const hasTurn = useRef(false);
  // Which end this phone is, and what kind of call: read from event
  // listeners, which would otherwise see the state from when they were added.
  const roleRef = useRef(null);
  const kindRef = useRef(null);
  // Every candidate each side offered, for resending the offer and for
  // saying which networks were tried when a call cannot connect.
  const localCandidates = useRef([]);
  const remoteCandidates = useRef([]);
  // A failed connection gets one ICE restart before the call is ended.
  const failTimer = useRef(null);

  const teardown = useCallback(() => {
    pc.current?.getSenders?.().forEach((sender) => {
      try { sender.track?.stop(); } catch { /* already gone */ }
    });
    try { pc.current?.close(); } catch { /* already closed */ }
    pc.current = null;

    localStreamRef.current?.getTracks?.().forEach((t) => { try { t.stop(); } catch { /* */ } });
    localStreamRef.current = null;

    audio.stopRing();
    audio.stopRingback();
    audio.screenOn(false);
    audio.stop();

    pendingCandidates.current = [];
    callIdRef.current = null;
    roleRef.current = null;
    kindRef.current = null;
    localCandidates.current = [];
    remoteCandidates.current = [];
    clearTimeout(failTimer.current);
    failTimer.current = null;
    restarted.current = false;
    setIceState(null);
    setRelayed(false);
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
    setSpeakerOn(false);
  }, []);

  /**
   * Android runtime permissions.
   *
   * react-native-webrtc does NOT request these itself — declaring CAMERA and
   * RECORD_AUDIO in the manifest is only half of it, and on Android 6+
   * getUserMedia simply rejects until the user has actually granted them.
   * That rejection was being swallowed into `error`, which only the call
   * screen renders, and the call screen never opened because the phase never
   * left 'idle'. The result: tapping Call did nothing at all, which is
   * indistinguishable from the button being a placeholder.
   */
  const ensurePermissions = useCallback(async (kind) => {
    if (Platform.OS !== 'android') return true;

    const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (kind === 'video') wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    // Android 12+ needs this to open the Bluetooth headset's audio route.
    if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
      wanted.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    }

    const granted = await PermissionsAndroid.requestMultiple(wanted);
    // Bluetooth is a nicety; the mic and camera are not.
    const required = kind === 'video'
      ? [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.CAMERA]
      : [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];

    const missing = required.filter((p) => granted[p] !== PermissionsAndroid.RESULTS.GRANTED);
    if (missing.length === 0) return true;

    Alert.alert(
      kind === 'video' ? 'Camera and microphone needed' : 'Microphone needed',
      'Allow access in Settings → Apps → loversrock → Permissions, then try the call again.'
    );
    return false;
  }, []);

  /** Mic, and camera only for a video call — never ask for more than needed. */
  const getMedia = useCallback(async (kind) => {
    if (!WebRTC) {
      Alert.alert('Calling unavailable', 'This build does not have calling support.');
      throw new Error('webrtc-missing');
    }
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video'
        ? { facingMode: 'user', width: 1280, height: 720, frameRate: 30 }
        : false,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  /** Why a call that was answered never connected. */
  const failureMessage = () => (hasTurn.current
    ? 'Could not connect, even through the relay. Check that both phones can reach the server.'
    : 'Could not find a path between the two phones, and the server has no relay: '
      + 'TURN_PUBLIC_IP is not set (see docker/turnserver.conf).');

  /** Which networks each phone offered, from the SDPs and trickled candidates. */
  const pathSummary = (connection) => describePaths(
    candidateLines(connection?.localDescription?.sdp, localCandidates.current.map((c) => c?.candidate)),
    candidateLines(connection?.remoteDescription?.sdp, remoteCandidates.current),
  );

  const buildPeerConnection = useCallback(async (kind, stream) => {
    const config = await apiFetch('/calls/config');
    hasTurn.current = Boolean(config?.hasTurn);
    const connection = new RTCPeerConnection({
      iceServers: config.iceServers,
      // Bundling everything on one transport means one ICE negotiation
      // instead of one per track, which is noticeably faster to connect.
      bundlePolicy: 'max-bundle',
      // Gather a few candidates before the offer is even built, so the first
      // exchange already carries usable addresses instead of relying wholly
      // on trickle. Shaves a visible beat off answering.
      iceCandidatePoolSize: 4,
    });

    stream.getTracks().forEach((track) => connection.addTrack(track, stream));

    connection.addEventListener('track', (event) => {
      if (event.streams?.[0]) setRemoteStream(event.streams[0]);
    });

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return; // null means gathering finished
      // A public address stays on this phone (see paths.js).
      if (!isPrivateCandidate(event.candidate.candidate)) return;
      const candidate = {
        candidate: scrubCandidate(event.candidate.candidate),
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      };
      localCandidates.current.push(candidate);
      getSocket()?.emit('call:ice', { callId: callIdRef.current, candidate });
    });

    connection.addEventListener('connectionstatechange', () => {
      const state = connection.connectionState;
      if (state === 'connected') {
        audio.stopRingback();
        audio.stopRing();
        setCall((c) => ({ ...c, phase: 'connected' }));
        clearTimeout(failTimer.current);
        failTimer.current = null;
      }
      // 'disconnected' often recovers on its own, so it is deliberately not
      // treated as the end of the call. 'failed' gets one ICE restart (below)
      // and fifteen seconds for it to work: ending the call the moment it
      // failed, as this used to, tore down the connection the restart was
      // trying to save, so the restart never once ran.
      if (state === 'failed' && !failTimer.current) {
        failTimer.current = setTimeout(() => {
          failTimer.current = null;
          if (pc.current !== connection || connection.connectionState === 'connected') return;
          setError(`${failureMessage()}\n\n${pathSummary(connection)}`);
          setCall((c) => ({ ...c, phase: 'ended' }));
          teardown();
        }, 15000);
      }
    });

    connection.addEventListener('iceconnectionstatechange', () => {
      const state = connection.iceConnectionState;
      setIceState(state);

      // One ICE restart before giving up. A candidate set gathered while the
      // phone was switching from Wi-Fi to mobile data is stale rather than
      // wrong, and re-gathering fixes it without dropping the call.
      // Only the caller restarts. Both ends restarting at once would each
      // send an offer while holding one of their own, and both would fail.
      if (state === 'failed' && !restarted.current && pc.current && roleRef.current === 'caller') {
        restarted.current = true;
        (async () => {
          try {
            const offer = await pc.current.createOffer({ iceRestart: true });
            await pc.current.setLocalDescription(offer);
            getSocket()?.emit('call:renegotiate', {
              callId: callIdRef.current, sdp: privateSdp(offer.sdp), type: offer.type,
            });
          } catch { /* the failure handler above still runs */ }
        })();
      }
    });

    // Which path the media actually took. "Connected" over a relay and
    // connected directly are both fine; not knowing which is not.
    connection.addEventListener('selectedcandidatepairchange', (event) => {
      const local = event?.selectedCandidatePair?.local?.candidate || '';
      setRelayed(/ relay /.test(local) || local.includes('typ relay'));
    });

    pc.current = connection;
    return connection;
  }, [teardown]);

  const flushCandidates = useCallback(async () => {
    const queued = pendingCandidates.current;
    pendingCandidates.current = [];
    for (const candidate of queued) {
      try { await pc.current?.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* stale */ }
    }
  }, []);

  /** Ring your partner. */
  const startCall = useCallback(async (kind = 'voice') => {
    setError(null);
    if (!(await ensurePermissions(kind))) return;
    try {
      // A video call belongs on the speaker; a voice call belongs on the
      // earpiece with the proximity sensor blanking the screen. `auto: true`
      // gives the second behaviour, and this gives the first.
      audio.start(kind === 'video' ? 'video' : 'audio');
      audio.screenOn(true);
      if (kind === 'video') { audio.speaker(true); setSpeakerOn(true); }

      const stream = await getMedia(kind);
      const { call: record } = await apiFetch('/calls/start', { method: 'POST', body: { kind } });
      callIdRef.current = record.id;
      roleRef.current = 'caller';
      kindRef.current = kind;
      setCall({ phase: 'ringing-out', kind, id: record.id, role: 'caller' });

      const connection = await buildPeerConnection(kind, stream);
      const offer = await connection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: kind === 'video',
      });
      await connection.setLocalDescription(offer);

      // The offer is the whole call. Emitting it into a socket that is not
      // actually connected is how this used to sit on "Calling…" forever:
      // socket.io buffers the emit, the handshake never completes, and the
      // other phone simply never rings. Wait for a live socket, and say so
      // if there isn't one.
      const socket = await waitForSocket();
      socket.emit('call:offer', { callId: record.id, kind, sdp: privateSdp(offer.sdp), type: offer.type });
      audio.ringback();   // so the caller hears that it is ringing
    } catch (err) {
      const message = err.body?.call ? 'A call is already in progress.' : err.message;
      setError(message);
      setCall(IDLE);
      teardown();
      // The call screen is where `error` is rendered, and a failure this
      // early means it never opened — so say it out loud instead of
      // failing silently.
      Alert.alert("Couldn't start the call", message);
    }
  }, [ensurePermissions, getMedia, buildPeerConnection, teardown]);

  /** Pick up. */
  const answerCall = useCallback(async () => {
    if (call.phase !== 'ringing-in' || !call.offer) return;
    setError(null);
    if (!(await ensurePermissions(call.kind))) return;
    try {
      audio.stopRing();
      audio.start(call.kind === 'video' ? 'video' : 'audio');
      audio.screenOn(true);
      if (call.kind === 'video') { audio.speaker(true); setSpeakerOn(true); }

      const stream = await getMedia(call.kind);
      const connection = await buildPeerConnection(call.kind, stream);

      await connection.setRemoteDescription(new RTCSessionDescription({
        type: 'offer', sdp: call.offer.sdp,
      }));
      await flushCandidates();

      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);

      await apiFetch(`/calls/${call.id}/answer`, { method: 'POST' });
      getSocket()?.emit('call:answer', { callId: call.id, sdp: privateSdp(answer.sdp), type: answer.type });
      setCall((c) => ({ ...c, phase: 'connecting' }));
    } catch (err) {
      // A 404 here means the caller gave up (or their call failed) before
      // this phone picked up: the call is over, not broken.
      setError(err.status === 404 ? 'That call already ended before you picked up.' : err.message);
      setCall(IDLE);
      teardown();
    }
  }, [call, ensurePermissions, getMedia, buildPeerConnection, flushCandidates, teardown]);

  /** Hang up, decline, or give up — the server works out which it was. */
  const endCall = useCallback(async (reason = 'hangup') => {
    const id = callIdRef.current || call.id;
    const wasDeclining = call.phase === 'ringing-in';
    setCall({ phase: 'ended', kind: call.kind });
    teardown();

    getSocket()?.emit(wasDeclining ? 'call:decline' : 'call:hangup', { callId: id });
    if (id) {
      await apiFetch(`/calls/${id}/end`, {
        method: 'POST',
        body: { reason: wasDeclining ? 'declined' : reason },
      }).catch(() => { /* the call is over either way */ });
    }
    setTimeout(() => setCall((c) => (c.phase === 'ended' ? IDLE : c)), 1200);
  }, [call, teardown]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }, []);

  const switchCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks?.()[0];
    // _switchCamera is react-native-webrtc's own extension to MediaStreamTrack.
    track?._switchCamera?.();
  }, []);

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((on) => {
      const next = !on;
      audio.speaker(next);
      return next;
    });
  }, []);

  /**
   * Is the partner ringing this phone right now? If so, ask for their offer.
   * Run whenever the socket (re)connects and whenever the app comes to the
   * front, which covers opening it from the incoming-call notification.
   */
  const askForRingingCall = useCallback(async () => {
    if (pc.current || callIdRef.current) return; // already in, or ringing with, a call
    try {
      const { call: live } = await apiFetch('/calls/current');
      if (live?.status === 'ringing' && live.role === 'callee' && !callIdRef.current) {
        getSocket()?.emit('call:want-offer', { callId: live.id });
      }
    } catch { /* offline or unpaired: nothing is ringing that can be answered */ }
  }, []);

  // ------------------------------------------------------------- signalling
  useEffect(() => {
    let socket;
    let cancelled = false;

    (async () => {
      socket = await connectSocket();
      if (cancelled) return;

      socket.on('call:offer', async (payload) => {
        // Already busy: tell them rather than silently ignoring it.
        if (pc.current) {
          socket.emit('call:decline', { callId: payload.callId, reason: 'busy' });
          return;
        }
        callIdRef.current = payload.callId;
        roleRef.current = 'callee';
        kindRef.current = payload.kind || 'voice';
        audio.ring(payload.callId, partnerNameRef.current, payload.kind || 'voice');
        setCall({
          phase: 'ringing-in',
          kind: payload.kind || 'voice',
          id: payload.callId,
          role: 'callee',
          offer: { sdp: payload.sdp },
        });
      });

      // The other end restarted ICE. Answer it on the same connection rather
      // than tearing the call down.
      socket.on('call:renegotiate', async (payload) => {
        if (!pc.current || !payload?.sdp) return;
        try {
          await pc.current.setRemoteDescription(new RTCSessionDescription({
            type: payload.type || 'offer', sdp: payload.sdp,
          }));
          const answer = await pc.current.createAnswer();
          await pc.current.setLocalDescription(answer);
          socket.emit('call:answer', { callId: payload.callId, sdp: privateSdp(answer.sdp), type: answer.type });
        } catch (err) {
          setError(err.message);
        }
      });

      socket.on('call:answer', async (payload) => {
        if (!pc.current) return;
        try {
          await pc.current.setRemoteDescription(new RTCSessionDescription({
            type: 'answer', sdp: payload.sdp,
          }));
          await flushCandidates();
          setCall((c) => ({ ...c, phase: 'connecting' }));
        } catch (err) {
          setError(err.message);
        }
      });

      socket.on('call:ice', async (payload) => {
        if (!payload?.candidate) return;
        remoteCandidates.current.push(payload.candidate.candidate);
        // Before the remote description exists, addIceCandidate throws — so
        // early candidates wait rather than being dropped.
        if (!pc.current?.remoteDescription) {
          pendingCandidates.current.push(payload.candidate);
          return;
        }
        try { await pc.current.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch { /* stale */ }
      });

      const remoteEnded = () => {
        setCall((c) => (c.phase === 'idle' ? c : { phase: 'ended', kind: c.kind }));
        teardown();
        setTimeout(() => setCall((c) => (c.phase === 'ended' ? IDLE : c)), 1200);
      };
      socket.on('call:hangup', remoteEnded);
      socket.on('call:decline', remoteEnded);
      socket.on('call:peer-gone', () => { if (pc.current) remoteEnded(); });

      // The callee's app was closed when the call came in, so the offer went
      // into a socket that was not there and was lost; the push opened the
      // app onto a call it had never heard of, with nothing to answer. The
      // callee asks for the offer again, and the caller, still ringing,
      // sends it again with every candidate gathered so far.
      socket.on('call:want-offer', (payload) => {
        const connection = pc.current;
        if (!connection || roleRef.current !== 'caller' || payload?.callId !== callIdRef.current) return;
        const sdp = connection.localDescription?.sdp;
        if (!sdp || connection.remoteDescription) return; // not offered yet, or already answered
        socket.emit('call:offer', { callId: callIdRef.current, kind: kindRef.current, sdp: privateSdp(sdp), type: 'offer' });
        localCandidates.current.forEach((candidate) => {
          socket.emit('call:ice', { callId: callIdRef.current, candidate });
        });
      });

      socket.on('connect', askForRingingCall);
      askForRingingCall();
    })();

    return () => {
      cancelled = true;
      const live = getSocket();
      ['call:offer', 'call:answer', 'call:ice', 'call:hangup', 'call:decline', 'call:peer-gone', 'call:renegotiate',
        'call:want-offer']
        .forEach((event) => live?.off(event));
      live?.off('connect', askForRingingCall);
    };
  }, [flushCandidates, teardown, askForRingingCall]);

  // Answered, but never actually connected.
  //
  // This is the other way a call hangs: both ends agree, ICE starts, and no
  // path is ever found. Without a deadline the screen says "Connecting…"
  // indefinitely, because 'failed' is a state ICE can take a very long time
  // to admit to — and on some networks never does.
  useEffect(() => {
    if (call.phase !== 'connecting') return undefined;
    const timer = setTimeout(() => {
      setError(`${failureMessage()}\n\n${pathSummary(pc.current)}`);
      endCall('ice-timeout');
    }, 30000);
    return () => clearTimeout(timer);
  }, [call.phase, endCall]);

  // Nobody picks up forever. Without this the caller stares at "Calling…"
  // until they kill the app, and the row stays 'ringing' in the history.
  useEffect(() => {
    if (call.phase !== 'ringing-out') return undefined;
    const timer = setTimeout(() => {
      setError('No answer.');
      endCall('no-answer');
    }, 45000);
    return () => clearTimeout(timer);
  }, [call.phase, endCall]);

  // A call that is still ringing when the app is killed would otherwise stay
  // "ringing" in the history forever.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'inactive' && call.phase === 'ringing-out') endCall('backgrounded');
      if (next === 'active' && call.phase === 'idle') askForRingingCall();
    });
    return () => sub.remove();
  }, [call.phase, endCall, askForRingingCall]);

  useEffect(() => () => teardown(), [teardown]);

  const value = useMemo(() => ({
    call, localStream, remoteStream, muted, cameraOff, speakerOn, error,
    iceState, relayed,
    startCall, answerCall, endCall,
    toggleMute, toggleCamera, switchCamera, toggleSpeaker,
    clearError: () => setError(null),
    isBusy: call.phase !== 'idle' && call.phase !== 'ended',
  }), [call, localStream, remoteStream, muted, cameraOff, speakerOn, error, iceState, relayed,
    startCall, answerCall, endCall, toggleMute, toggleCamera, switchCamera, toggleSpeaker]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside a CallProvider');
  return ctx;
}
