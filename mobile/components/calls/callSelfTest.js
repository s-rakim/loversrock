// "Do calls work from this phone?", answered by doing it: Diagnostics joins
// a room of its own on the call server (docker/calls) and reports the first
// step that fails.
//
//   1. The websocket (port 4100): can this phone reach the call server?
//   2. The media path (UDP 4110-4130, or TCP 4101): does audio actually get
//      to it? This is the step a firewall or a wrong CALLS_PUBLIC_IP breaks,
//      and the one a plain "is the server up" check cannot see.
//
// Each failure says what to change on the PC, because that is where every
// one of them is fixed.
import { SfuSession, newClientId } from './sfu';

const SOCKET_MS = 6000;
const MEDIA_MS = 12000;

/**
 * Runs the test. `getStream` returns a microphone stream (the server only
 * sets up media for a phone that sends some). Resolves to
 * { ok, step: 'socket' | 'media' | 'done', detail }.
 */
export async function testCallServer({
  url, webrtc, getStream, WebSocketImpl = globalThis.WebSocket,
  socketMs = SOCKET_MS, mediaMs = MEDIA_MS,
}) {
  if (!url) return { ok: false, step: 'socket', detail: 'The server did not offer a call server.' };

  // 1. The websocket on its own, so a refused connection is told apart from
  // media that never arrives.
  const reached = await new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; clearTimeout(timer); try { ws?.close(); } catch { /* gone */ } resolve(value); } };
    let ws = null;
    const timer = setTimeout(() => finish(false), socketMs);
    try {
      ws = new WebSocketImpl(`${url.replace(/\/+$/, '')}/selftest-${newClientId('r')}/${newClientId('t')}`);
    } catch {
      finish(false);
      return;
    }
    ws.onopen = () => finish(true);
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
  if (!reached) {
    return {
      ok: false,
      step: 'socket',
      detail: `This phone cannot reach the call server (${url}). On the PC: is the calls container running `
        + '(docker compose ps), and does Windows Firewall allow TCP 4100?',
    };
  }

  // 2. Media: join a room alone, publish the microphone, and wait for the
  // connection to the server to come up.
  let stream = null;
  try {
    stream = await getStream();
  } catch (err) {
    return { ok: false, step: 'media', detail: `Could not use the microphone for the test: ${err?.message || err}` };
  }
  let session = null;
  const result = await new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish({ ok: false }), mediaMs);
    session = new SfuSession({
      url,
      room: `selftest-${newClientId('r')}`,
      clientId: newClientId('t'),
      nickname: 'self-test',
      stream,
      webrtc,
      WebSocketImpl,
      onIceState: (state) => {
        if (state === 'connected' || state === 'completed') finish({ ok: true });
        if (state === 'failed') finish({ ok: false });
      },
      onClosed: (reason) => finish({ ok: false, reason }),
    }).start();
  });

  let route = '';
  if (result.ok) route = await connectedRoute(session?.pc);
  session?.close();
  stream?.getTracks?.().forEach((t) => t.stop?.());

  if (result.ok) {
    return { ok: true, step: 'done', detail: `Audio reaches the call server${route ? ` (${route})` : ''}. Calls should connect.` };
  }
  return {
    ok: false,
    step: 'media',
    detail: result.reason
      ? `The call server hung up: ${result.reason}.`
      : 'This phone reaches the call server, but audio cannot get through to it. On the PC: '
        + 'CALLS_PUBLIC_IP in docker\\.env must be the PC\'s Tailscale address (tailscale ip -4), '
        + 'and Windows Firewall must allow UDP 4110-4130 and TCP 4101. Then docker compose up -d.',
  };
}

/** "UDP" or "TCP", from the candidate pair the connection settled on. */
async function connectedRoute(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    const byId = new Map();
    stats.forEach((s) => {
      byId.set(s.id, s);
      if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') pair = s;
    });
    const remote = pair && byId.get(pair.remoteCandidateId);
    return remote?.protocol ? String(remote.protocol).toUpperCase() : '';
  } catch {
    return '';
  }
}
