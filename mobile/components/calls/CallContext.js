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
import { Platform, AppState, PermissionsAndroid, Alert } from 'react-native';
import {
  RTCPeerConnection, RTCSessionDescription, RTCIceCandidate,
  mediaDevices, registerGlobals,
} from 'react-native-webrtc';
import { apiFetch, connectSocket, getSocket } from '../../services/api';

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
const audio = {
  start: (media) => { try { InCallManager?.start({ media, auto: true }); } catch { /* no native module */ } },
  stop: () => { try { InCallManager?.stop(); } catch { /* */ } },
  speaker: (on) => { try { InCallManager?.setForceSpeakerphoneOn(on); } catch { /* */ } },
  ring: () => { try { InCallManager?.startRingtone('_DEFAULT_'); } catch { /* */ } },
  stopRing: () => { try { InCallManager?.stopRingtone(); } catch { /* */ } },
  ringback: () => { try { InCallManager?.startRingback('_DEFAULT_'); } catch { /* */ } },
  stopRingback: () => { try { InCallManager?.stopRingback(); } catch { /* */ } },
  screenOn: (on) => { try { InCallManager?.setKeepScreenOn(on); } catch { /* */ } },
};
export const hasAudioRouting = () => InCallManager !== null;

// react-native-webrtc needs its globals installed once, before any peer
// connection is built.
registerGlobals();

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

  const pc = useRef(null);
  const localStreamRef = useRef(null);
  // ICE candidates can arrive before the remote description is set, and
  // addIceCandidate throws if it does. They are queued and flushed after.
  const pendingCandidates = useRef([]);
  const callIdRef = useRef(null);

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

  const buildPeerConnection = useCallback(async (kind, stream) => {
    const { iceServers } = await apiFetch('/calls/config');
    const connection = new RTCPeerConnection({
      iceServers,
      // Bundling everything on one transport means one ICE negotiation
      // instead of one per track, which is noticeably faster to connect.
      bundlePolicy: 'max-bundle',
    });

    stream.getTracks().forEach((track) => connection.addTrack(track, stream));

    connection.addEventListener('track', (event) => {
      if (event.streams?.[0]) setRemoteStream(event.streams[0]);
    });

    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return; // null means gathering finished
      getSocket()?.emit('call:ice', {
        callId: callIdRef.current,
        candidate: event.candidate,
      });
    });

    connection.addEventListener('connectionstatechange', () => {
      const state = connection.connectionState;
      if (state === 'connected') {
        audio.stopRingback();
        audio.stopRing();
        setCall((c) => ({ ...c, phase: 'connected' }));
      }
      // 'failed' is terminal; 'disconnected' often recovers on its own, so
      // it is deliberately not treated as the end of the call.
      if (state === 'failed') {
        setError('The connection failed. You may both be behind strict NAT — a TURN server would fix it.');
        setCall((c) => ({ ...c, phase: 'ended' }));
        teardown();
      }
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
      setCall({ phase: 'ringing-out', kind, id: record.id, role: 'caller' });

      const connection = await buildPeerConnection(kind, stream);
      const offer = await connection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: kind === 'video',
      });
      await connection.setLocalDescription(offer);

      const socket = await connectSocket();
      socket.emit('call:offer', { callId: record.id, kind, sdp: offer.sdp, type: offer.type });
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
      getSocket()?.emit('call:answer', { callId: call.id, sdp: answer.sdp, type: answer.type });
      setCall((c) => ({ ...c, phase: 'connecting' }));
    } catch (err) {
      setError(err.message);
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
        audio.ring();
        setCall({
          phase: 'ringing-in',
          kind: payload.kind || 'voice',
          id: payload.callId,
          role: 'callee',
          offer: { sdp: payload.sdp },
        });
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
    })();

    return () => {
      cancelled = true;
      const live = getSocket();
      ['call:offer', 'call:answer', 'call:ice', 'call:hangup', 'call:decline', 'call:peer-gone']
        .forEach((event) => live?.off(event));
    };
  }, [flushCandidates, teardown]);

  // A call that is still ringing when the app is killed would otherwise stay
  // "ringing" in the history forever.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'inactive' && call.phase === 'ringing-out') endCall('backgrounded');
    });
    return () => sub.remove();
  }, [call.phase, endCall]);

  useEffect(() => () => teardown(), [teardown]);

  const value = useMemo(() => ({
    call, localStream, remoteStream, muted, cameraOff, speakerOn, error,
    startCall, answerCall, endCall,
    toggleMute, toggleCamera, switchCamera, toggleSpeaker,
    clearError: () => setError(null),
    isBusy: call.phase !== 'idle' && call.phase !== 'ended',
  }), [call, localStream, remoteStream, muted, cameraOff, speakerOn, error,
    startCall, answerCall, endCall, toggleMute, toggleCamera, switchCamera, toggleSpeaker]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside a CallProvider');
  return ctx;
}
