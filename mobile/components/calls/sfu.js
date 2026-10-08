// A call through the media server: peer-calls' SFU (docker/calls), which
// both phones connect to instead of to each other.
//
// Why. A call between two phones needs one phone to reach the other, and
// between two phones on mobile data, behind their carriers' NAT, often
// neither can. Both phones can always reach the server, though: everything
// else in the app already goes there. So each phone sends its camera and
// microphone to the server, and the server forwards them to the other phone,
// the way Instagram, WhatsApp and every group-call service does it.
//
// This is peer-calls' own client protocol (src/client in
// github.com/peer-calls/peer-calls: SocketActions.ts, PeerActions.ts, and
// simple-peer's signalling), written against the standard WebRTC API so it
// runs on react-native-webrtc on the phones and in a browser in the tests:
//
//   ws  /ws/<room>/<clientId>
//   →   ready     { nickname }
//   ←   users     { initiator: '__SERVER__', ... }   the server offers first
//   ←   signal    { peerId: '__SERVER__', signal: offer | candidate }
//   →   signal    { peerId: '__SERVER__', signal: answer | candidate }
//   ←   pubTrack  { trackId, pubClientId, kind, type: 1 (added) | 2 (removed) }
//   →   subTrack  { trackId, pubClientId, type: 3 (subscribe) }
//   ←   ping      → pong   (every five seconds, or the server hangs up)
//   →   hangUp    { peerId }
//
// Messages are { type, room, payload }. The server is always the initiator:
// it offers, this end answers, and every track the other phone publishes is
// subscribed to, which makes the server offer again with that track in it.

export const SERVER_PEER = '__SERVER__';
const TRACK_ADDED = 1;
const TRACK_SUB = 3;

/** ws://host:4100/ws/<room>/<client>, with the join pass when there is one. */
export function roomAddress(url, room, clientId, pass = null) {
  const base = `${String(url).replace(/\/+$/, '')}/${encodeURIComponent(room)}/${encodeURIComponent(clientId)}`;
  return pass ? `${base}?t=${encodeURIComponent(pass)}` : base;
}

/** A random id for this phone in the room; the server keys everything by it. */
export function newClientId(prefix = 'p') {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand()}${rand()}`;
}

export class SfuSession {
  /**
   * `webrtc` is { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate,
   * MediaStream } (react-native-webrtc on the phones, the browser's own in
   * tests). `url` is the server's /ws address, e.g. ws://100.x.y.z:4100/ws.
   */
  constructor({
    url, room, clientId, nickname = '', stream, webrtc, iceServers = [],
    pass = null, getPass = null,
    WebSocketImpl = globalThis.WebSocket,
    onRemoteStream = () => {}, onIceState = () => {}, onPeerLeft = () => {}, onClosed = () => {},
    log = () => {},
  }) {
    Object.assign(this, {
      url, room, clientId, nickname, stream, webrtc, iceServers, WebSocketImpl,
      pass, getPass, onRemoteStream, onIceState, onPeerLeft, onClosed, log,
    });
    this.pc = null;
    this.ws = null;
    this.closed = false;
    this.pendingCandidates = [];
    this.remoteStreams = new Map();
    this.subscribed = new Set();
    // Signals are handled one at a time, in order: an offer must be answered
    // before the candidates that follow it can be added.
    this.queue = Promise.resolve();
  }

  /**
   * Connects. With `getPass`, a pass into this room is asked of our own
   * backend first (GET /calls/sfu-pass): the call server lets nobody into a
   * room without one. A fresh pass for every join, so a call that rejoins
   * hours in still gets in.
   */
  start() {
    if (this.getPass && !this.pass) {
      Promise.resolve()
        .then(() => this.getPass(this.room))
        .then((pass) => { this.pass = pass || null; }, (err) => this.log('no pass', err?.message || ''))
        .then(() => { if (!this.closed) this.connect(); });
      return this;
    }
    return this.connect();
  }

  connect() {
    const address = roomAddress(this.url, this.room, this.clientId, this.pass);
    this.log('connect', address.replace(/\?t=.*$/, '?t=…'));
    const ws = new this.WebSocketImpl(address);
    this.ws = ws;
    ws.onopen = () => this.send('ready', { nickname: this.nickname });
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this.handle(msg);
    };
    ws.onerror = (event) => this.log('socket error', event?.message || '');
    ws.onclose = () => {
      if (!this.closed) this.close({ notify: true, reason: 'server closed the connection' });
    };
    return this;
  }

  send(type, payload) {
    if (this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type, room: this.room, payload }));
  }

  signal(signal) {
    this.send('signal', { peerId: SERVER_PEER, signal });
  }

  handle(msg) {
    const { type, payload } = msg || {};
    switch (type) {
      case 'ping':
        this.send('pong', {});
        break;
      case 'users':
        if (!this.pc) this.createPeer();
        break;
      case 'signal':
        if (payload?.signal) this.enqueue(() => this.handleSignal(payload.signal));
        break;
      case 'pubTrack':
        // Someone else's camera or microphone: ask for it. (Our own comes
        // back too, and is skipped.)
        if (payload?.type === TRACK_ADDED && payload.pubClientId !== this.clientId) {
          const key = `${payload.pubClientId}|${payload.trackId?.id}|${payload.trackId?.streamId}`;
          if (this.subscribed.has(key)) break;
          this.subscribed.add(key);
          this.send('subTrack', { trackId: payload.trackId, pubClientId: payload.pubClientId, type: TRACK_SUB });
        }
        break;
      case 'hangUp':
        if (payload?.peerId && payload.peerId !== this.clientId) this.onPeerLeft(payload.peerId);
        break;
      default:
        break;
    }
  }

  enqueue(task) {
    this.queue = this.queue.then(task).catch((err) => this.log('signal failed', err?.message || String(err)));
    return this.queue;
  }

  createPeer() {
    const { RTCPeerConnection } = this.webrtc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    this.pc = pc;
    // Added before the server's first offer arrives, so its receive-only
    // audio and video lines pick these up: that is how this phone publishes.
    this.stream?.getTracks().forEach((track) => pc.addTrack(track, this.stream));

    pc.onicecandidate = (event) => {
      const c = event.candidate;
      if (!c) return;
      this.signal({
        type: 'candidate',
        candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex },
      });
    };
    pc.oniceconnectionstatechange = () => this.onIceState(pc.iceConnectionState);
    pc.ontrack = (event) => {
      const track = event.track;
      // One stream for the other phone, however the server groups its tracks.
      const id = event.streams?.[0]?.id || 'remote';
      let remote = this.remoteStreams.get(id);
      if (!remote) {
        remote = event.streams?.[0] || new this.webrtc.MediaStream();
        this.remoteStreams.set(id, remote);
      }
      if (!remote.getTracks().some((t) => t.id === track.id)) remote.addTrack?.(track);
      this.onRemoteStream(remote, track);
    };
  }

  async handleSignal(signal) {
    if (!this.pc) this.createPeer();
    const pc = this.pc;
    if (signal.candidate) {
      if (!signal.candidate.candidate) return;
      if (!pc.remoteDescription) {
        this.pendingCandidates.push(signal.candidate);
        return;
      }
      await pc.addIceCandidate(new this.webrtc.RTCIceCandidate(signal.candidate)).catch(() => {});
      return;
    }
    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new this.webrtc.RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
      const queued = this.pendingCandidates;
      this.pendingCandidates = [];
      for (const c of queued) {
        // eslint-disable-next-line no-await-in-loop
        await pc.addIceCandidate(new this.webrtc.RTCIceCandidate(c)).catch(() => {});
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signal({ type: 'answer', sdp: answer.sdp });
      return;
    }
    if (signal.type === 'answer') {
      await pc.setRemoteDescription(new this.webrtc.RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
    }
  }

  /** Leave the room. `notify` reports it to onClosed (the server hung up). */
  close({ notify = false, reason = '' } = {}) {
    if (this.closed) return;
    this.closed = true;
    try { this.send('hangUp', { peerId: this.clientId }); } catch { /* gone */ }
    try { this.ws?.close(); } catch { /* gone */ }
    try { this.pc?.close(); } catch { /* gone */ }
    this.pc = null;
    if (notify) this.onClosed(reason);
  }
}

/**
 * A call's place on the call server, kept through network trouble.
 *
 * Learned from Nextcloud Talk's CallActivity, which never treats a dropped
 * connection as the end of a call: the signalling socket closing, or the
 * media connection failing, puts the call into "Reconnecting…" and it joins
 * the room again, with the same microphone and camera, until it is back or
 * has plainly gone for good. A phone moving from Wi-Fi to mobile data, or a
 * lift, should cost a few seconds of frozen picture, not the call.
 *
 * Same options as SfuSession, plus:
 *   onReconnecting(bool)  "Reconnecting…" on and off
 *   onClosed(reason)      gave up (after `attempts` tries)
 */
export class SfuCall {
  constructor({
    attempts = 6, disconnectGraceMs = 4000, backoffMs = [500, 1000, 2000, 3000, 5000, 8000],
    onReconnecting = () => {}, onClosed = () => {}, onIceState = () => {}, onRemoteStream = () => {},
    clientPrefix = 'p', ...session
  }) {
    Object.assign(this, {
      attempts, disconnectGraceMs, backoffMs, onReconnecting, onClosed, onIceState, onRemoteStream, clientPrefix, session,
    });
    this.current = null;
    this.tries = 0;
    this.reconnecting = false;
    this.ended = false;
    this.graceTimer = null;
    this.retryTimer = null;
  }

  get pc() { return this.current?.pc || null; }

  start() {
    this.join();
    return this;
  }

  join() {
    if (this.ended) return;
    const session = new SfuSession({
      ...this.session,
      clientId: newClientId(this.clientPrefix),
      onIceState: (state) => {
        if (this.current !== session) return;
        this.onIceState(state);
        clearTimeout(this.graceTimer);
        if (state === 'connected' || state === 'completed') {
          this.recovered();
        } else if (state === 'failed') {
          this.lost(session, 'the connection to the call server failed');
        } else if (state === 'disconnected') {
          // Often a blip that heals by itself: give it a moment first.
          this.graceTimer = setTimeout(() => this.lost(session, 'the connection to the call server dropped'), this.disconnectGraceMs);
        }
      },
      onRemoteStream: (remote, track) => {
        if (this.current !== session) return;
        this.recovered();
        this.onRemoteStream(remote, track);
      },
      onClosed: (reason) => {
        if (this.current === session) this.lost(session, reason);
      },
    });
    this.current = session;
    session.start();
  }

  recovered() {
    this.tries = 0;
    if (this.reconnecting) {
      this.reconnecting = false;
      this.onReconnecting(false);
    }
  }

  lost(session, reason) {
    if (this.ended || this.current !== session) return;
    clearTimeout(this.graceTimer);
    session.close();
    this.current = null;
    if (this.tries >= this.attempts) {
      this.end();
      this.onClosed(reason);
      return;
    }
    if (!this.reconnecting) {
      this.reconnecting = true;
      this.onReconnecting(true);
    }
    const wait = this.backoffMs[Math.min(this.tries, this.backoffMs.length - 1)];
    this.tries += 1;
    this.retryTimer = setTimeout(() => this.join(), wait);
  }

  /** Leave for good (hang up). */
  end() {
    this.ended = true;
    clearTimeout(this.graceTimer);
    clearTimeout(this.retryTimer);
    this.current?.close();
    this.current = null;
  }

  close() { this.end(); }
}
