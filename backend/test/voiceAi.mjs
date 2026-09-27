// The voice-note AI connector and voice effects, end to end.
//
// A stand-in provider on :4555 speaks the two OpenAI-compatible APIs the
// connector uses — /audio/transcriptions and /chat/completions — so the whole
// path runs without a real key. The API under test must be started pointed
// at it:
//
//   VOICE_AI_TRANSCRIBE_PROVIDER=custom VOICE_AI_TRANSCRIBE_BASE_URL=http://localhost:4555/v1 \
//   VOICE_AI_TRANSLATE_PROVIDER=custom VOICE_AI_TRANSLATE_MODEL=mock \
//   VOICE_AI_TRANSLATE_BASE_URL=http://localhost:4555/v1 VOICE_AI_TRANSLATE_API_KEY=k \
//   npm start
//
//   node --env-file=.env test/voiceAi.mjs
//
// The effects need ffmpeg on the machine running the API.
import http from 'http';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
const stamp = Date.now();
let pass = 0; const fails = [];
const check = (n, c, d) => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n} :: ${JSON.stringify(d)?.slice(0, 300)}`); } };

// ------------------------------------------------------------ the provider
const seen = { transcribe: [], translate: [] };
const provider = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/audio/transcriptions') {
      const text = body.toString('latin1');
      seen.transcribe.push({
        filename: /filename="([^"]+)"/.exec(text)?.[1],
        model: /name="model"\r\n\r\n([^\r]+)/.exec(text)?.[1],
        bytes: body.length,
      });
      res.end(JSON.stringify({ text: ' I miss you, call me later ' }));
    } else if (req.url === '/v1/chat/completions') {
      const json = JSON.parse(body.toString());
      seen.translate.push({ auth: req.headers.authorization, json });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Tu me manques, appelle-moi plus tard' } }] }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
});
await new Promise((r) => provider.listen(4555, r));

// -------------------------------------------------------------- the couple
const req = async (p, o = {}) => {
  const res = await fetch(`${API}${p}`, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) };
};
const signup = async (n) => {
  const u = { email: `voiceai-${n}${stamp}@t.dev`, password: 'pw123456', name: n };
  const r = await req('/auth/signup', { method: 'POST', body: u });
  return { ...u, token: r.data.accessToken, id: r.data.user.id };
};
const A = await signup('Ana');
const B = await signup('Ben');
const invite = await req('/auth/invite', { method: 'POST', token: A.token, body: { deviceTimezone: 'UTC' } });
await req('/auth/invite/accept', { method: 'POST', token: B.token, body: { inviteCode: invite.data.inviteCode, deviceTimezone: 'UTC' } });

// A real two-second recording, the way a phone makes one: AAC in .m4a.
const dir = mkdtempSync(join(tmpdir(), 'voiceai-'));
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-ac', '1', '-c:a', 'aac', '-b:a', '64k', join(dir, 'tone.m4a')]);
const audio = readFileSync(join(dir, 'tone.m4a'));

console.log('=== WHAT IS SWITCHED ON ===');
const ai = await req('/voice/ai', { token: B.token });
check('the app can see transcription is on', ai.data?.transcribe?.on === true, ai.data);
check('and translation', ai.data?.translate?.on === true, ai.data);
check('with the languages on offer', ai.data?.languages?.fr === 'French', ai.data?.languages);
check('and the voice effects', ai.data?.filters?.chipmunk === 'Chipmunk', ai.data?.filters);
check('and nothing chosen to translate into yet', ai.data?.translateTo === null, ai.data?.translateTo);

const badLang = await req('/voice/settings', { method: 'PUT', token: B.token, body: { translateTo: 'xx' } });
check('an unknown language is refused', badLang.status === 400, badLang);
const setLang = await req('/voice/settings', { method: 'PUT', token: B.token, body: { translateTo: 'fr' } });
check('the listener picks French', setLang.status === 200 && setLang.data.translateTo === 'fr', setLang.data);

console.log('\n=== A NOTE IS TRANSCRIBED, AND TRANSLATED FOR THE LISTENER ===');
const socketB = io(API, { auth: { token: B.token }, transports: ['websocket'] });
const transcribed = new Promise((resolve) => socketB.on('voice:transcript', resolve));
await new Promise((resolve) => socketB.on('connect', resolve));

const sent = await req('/voice', {
  method: 'POST', token: A.token,
  body: { audio: audio.toString('base64'), mimeType: 'audio/mp4', durationMs: 2000 },
});
check('it sends without waiting for the transcript', sent.status === 201, sent.data);
check('and says a transcript is on its way', sent.data.voice.transcript_status === 'pending', sent.data.voice);

const event = await Promise.race([transcribed, new Promise((r) => setTimeout(() => r(null), 8000))]);
check('the transcript arrives over the socket', event?.id === sent.data.voice.id, event);
check('trimmed', event?.transcript === 'I miss you, call me later', event?.transcript);
check('marked done', event?.transcript_status === 'done', event);
check('already translated into the listener’s language', event?.translations?.fr === 'Tu me manques, appelle-moi plus tard', event?.translations);
socketB.close();

check('the provider was sent the recording as an .m4a', seen.transcribe[0]?.filename === 'voice.m4a', seen.transcribe[0]);
check('with the default model for a custom endpoint', seen.transcribe[0]?.model === 'whisper-1', seen.transcribe[0]);
check('the translator got the transcript and the language',
  /French/.test(seen.translate[0]?.json?.messages?.[1]?.content) && /I miss you/.test(seen.translate[0]?.json?.messages?.[1]?.content),
  seen.translate[0]?.json?.messages);
check('with the key', seen.translate[0]?.auth === 'Bearer k', seen.translate[0]?.auth);

const list = await req('/voice', { token: B.token });
const row = list.data.voiceMessages.find((v) => v.id === sent.data.voice.id);
check('the list carries the transcript too', row?.transcript === 'I miss you, call me later', row);

console.log('\n=== TRANSLATING ON DEMAND ===');
const cached = await req(`/voice/${row.id}/translate`, { method: 'POST', token: B.token, body: { language: 'fr' } });
check('a translation already made comes from the cache', cached.data?.cached === true, cached.data);
const before = seen.translate.length;
const fresh = await req(`/voice/${row.id}/translate`, { method: 'POST', token: A.token, body: { language: 'es' } });
check('a new language asks the model', fresh.status === 200 && fresh.data.cached === false && seen.translate.length === before + 1, fresh.data);
const again = await req(`/voice/${row.id}/translate`, { method: 'POST', token: B.token, body: { language: 'es' } });
check('and is remembered for next time', again.data?.cached === true, again.data);
const nope = await req(`/voice/${row.id}/translate`, { method: 'POST', token: B.token, body: { language: 'klingon' } });
check('an unknown language is refused', nope.status === 400, nope);

const retry = await req(`/voice/${row.id}/transcribe`, { method: 'POST', token: B.token });
check('a transcript can be redone on request', retry.status === 200 && retry.data.voice.transcript === 'I miss you, call me later', retry.data);

console.log('\n=== VOICE EFFECTS ===');
const chip = await req('/voice', {
  method: 'POST', token: A.token,
  body: { audio: audio.toString('base64'), mimeType: 'audio/mp4', durationMs: 2000, filter: 'chipmunk' },
});
check('a note sends with an effect', chip.status === 201 && chip.data.filterApplied === true, chip.data);
check('and remembers which', chip.data.voice.filter === 'chipmunk', chip.data.voice);

const listA = await req('/voice', { token: B.token });
const chipRow = listA.data.voiceMessages.find((v) => v.id === chip.data.voice.id);
const played = Buffer.from(await (await fetch(`${API}${chipRow.path}`)).arrayBuffer());
check('what plays is not what was recorded', played.length > 0 && !played.equals(audio), played.length);

// The effect should really move the pitch: 440 Hz up by 1.45 is ~638 Hz.
const file = join(dir, 'chip.m4a');
execFileSync('bash', ['-c', `cat > ${file}`], { input: played });
const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
check('and it is still about two seconds long', Math.abs(Number(probe) - 2) < 0.3, probe);
const pcm = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '8000', '-']);
let crossings = 0;
for (let i = 2; i + 2 < pcm.length; i += 2) {
  if ((pcm.readInt16LE(i - 2) < 0) !== (pcm.readInt16LE(i) < 0)) crossings++;
}
const hz = crossings / 2 / (pcm.length / 2 / 8000);
check('with the pitch raised (440 Hz became roughly 640)', hz > 580 && hz < 700, Math.round(hz));

for (const filter of ['deep', 'robot', 'echo', 'radio']) {
  const r = await req('/voice', {
    method: 'POST', token: A.token,
    body: { audio: audio.toString('base64'), mimeType: 'audio/mp4', durationMs: 2000, filter },
  });
  check(`the ${filter} effect applies`, r.status === 201 && r.data.filterApplied === true, r.data);
}
const unknown = await req('/voice', {
  method: 'POST', token: A.token,
  body: { audio: audio.toString('base64'), mimeType: 'audio/mp4', durationMs: 2000, filter: 'kazoo' },
});
check('an unknown effect is refused', unknown.status === 400, unknown);

provider.close();
console.log(`\nVOICE AI RESULT — PASSED: ${pass}  FAILED: ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
process.exit(0);
