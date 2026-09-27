// Voice effects, applied on the server with ffmpeg.
//
// Server-side rather than on the phone because a phone's audio stack has no
// portable way to re-pitch a recording, and ffmpeg already does all of these
// well. No keys, no account: the backend image installs ffmpeg (Dockerfile).
// Without ffmpeg on the machine, a note is simply sent as recorded — an
// effect is decoration, never a reason for a note not to arrive.
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const RATE = 44100;

// Pitch without changing speed: resample to a known rate, reinterpret it at a
// higher or lower one (which moves pitch AND speed), then atempo puts the
// speed back.
const pitch = (factor) =>
  `aresample=${RATE},asetrate=${Math.round(RATE * factor)},aresample=${RATE},atempo=${(1 / factor).toFixed(4)}`;

export const VOICE_FILTERS = {
  chipmunk: { label: 'Chipmunk', af: pitch(1.45) },
  deep: { label: 'Deep', af: pitch(0.75) },
  robot: {
    label: 'Robot',
    af: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  },
  echo: { label: 'Echo', af: 'aecho=0.8:0.88:60:0.4' },
  radio: { label: 'Radio', af: 'highpass=f=400,lowpass=f=3200,volume=1.6' },
};

let ffmpegMissing = false;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`))));
  });
}

/**
 * The recording with `filter` applied, as AAC in an .m4a — or null if the
 * effect could not be applied, in which case the caller sends the original.
 */
export async function applyVoiceFilter(buffer, filter) {
  const preset = VOICE_FILTERS[filter];
  if (!preset || ffmpegMissing) return null;

  const dir = await mkdtemp(join(tmpdir(), 'voice-'));
  try {
    const input = join(dir, 'in');
    const output = join(dir, 'out.m4a');
    await writeFile(input, buffer);
    await run([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-af', preset.af,
      '-ac', '1', '-c:a', 'aac', '-b:a', '64k',
      // The index at the front, so a player can start before the end arrives.
      '-movflags', '+faststart',
      output,
    ]);
    return await readFile(output);
  } catch (err) {
    if (err.code === 'ENOENT') {
      ffmpegMissing = true;
      console.warn('[voice] ffmpeg is not installed — voice effects are off, notes send as recorded');
    } else {
      console.error(`[voice] "${filter}" effect failed:`, err.message);
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
