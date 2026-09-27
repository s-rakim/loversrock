// The AI connector for voice notes — optional, and off until keys are set.
//
// Two jobs, because no single model does both:
//
//   TRANSCRIBE — speech to text, so a note can be read when it cannot be
//   played out loud. Any OpenAI-compatible /audio/transcriptions endpoint:
//
//     VOICE_AI_TRANSCRIBE_PROVIDER   openai | groq | custom
//     VOICE_AI_TRANSCRIBE_API_KEY    the key from that provider
//     VOICE_AI_TRANSCRIBE_MODEL      optional — gpt-4o-mini-transcribe for
//                                    openai, whisper-large-v3-turbo for groq
//     VOICE_AI_TRANSCRIBE_BASE_URL   optional; required for `custom` (a
//                                    Whisper server of your own, say)
//
//   TRANSLATE — the transcript into the language the listener asked for.
//   Claude through Anthropic's SDK, or any OpenAI-compatible chat API:
//
//     VOICE_AI_TRANSLATE_PROVIDER    anthropic | openai | gemini | groq |
//                                    openrouter | mistral | deepseek |
//                                    together | ollama | custom
//     VOICE_AI_TRANSLATE_API_KEY     not needed for ollama
//     VOICE_AI_TRANSLATE_MODEL       optional for anthropic (claude-opus-5),
//                                    required for the rest
//     VOICE_AI_TRANSLATE_BASE_URL    optional; required for `custom`
//
// Nothing here can stop a voice note being sent or played: every failure is
// caught by the caller, logged, and recorded as transcript_status 'failed'.
import { PROVIDER_URLS } from './quizGenerator.js';

const TIMEOUT_MS = 60_000;
const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';

const TRANSCRIBE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
};
const TRANSCRIBE_DEFAULT_MODELS = {
  openai: 'gpt-4o-mini-transcribe',
  groq: 'whisper-large-v3-turbo',
};

/** Language codes the app offers, with the names a model is told. */
export const TRANSLATE_LANGUAGES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', sw: 'Swahili', ar: 'Arabic', hi: 'Hindi', zh: 'Chinese (Simplified)',
  ja: 'Japanese', ko: 'Korean', ru: 'Russian', tr: 'Turkish', pl: 'Polish', uk: 'Ukrainian',
  yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', am: 'Amharic', zu: 'Zulu', id: 'Indonesian',
  vi: 'Vietnamese', th: 'Thai', fil: 'Filipino', sv: 'Swedish', el: 'Greek',
};

const clean = (value) => String(value || '').trim();

/** Transcription settings, or null when off. Throws, plainly, when half set up. */
export function transcribeConfig(env = process.env) {
  const provider = clean(env.VOICE_AI_TRANSCRIBE_PROVIDER).toLowerCase();
  if (!provider) return null;
  const known = ['custom', ...Object.keys(TRANSCRIBE_URLS)];
  if (!known.includes(provider)) {
    throw new Error(`VOICE_AI_TRANSCRIBE_PROVIDER "${provider}" is not one of: ${known.join(', ')}`);
  }
  const apiKey = clean(env.VOICE_AI_TRANSCRIBE_API_KEY);
  if (!apiKey && provider !== 'custom') throw new Error(`VOICE_AI_TRANSCRIBE_API_KEY is needed for ${provider}`);
  const baseUrl = clean(env.VOICE_AI_TRANSCRIBE_BASE_URL).replace(/\/+$/, '') || TRANSCRIBE_URLS[provider] || null;
  if (!baseUrl) throw new Error('VOICE_AI_TRANSCRIBE_BASE_URL is needed for a custom provider');
  const model = clean(env.VOICE_AI_TRANSCRIBE_MODEL) || TRANSCRIBE_DEFAULT_MODELS[provider] || 'whisper-1';
  return { provider, apiKey, baseUrl, model };
}

/** Translation settings, or null when off. Throws, plainly, when half set up. */
export function translateConfig(env = process.env) {
  const provider = clean(env.VOICE_AI_TRANSLATE_PROVIDER).toLowerCase();
  if (!provider) return null;
  const known = ['anthropic', 'custom', ...Object.keys(PROVIDER_URLS)];
  if (!known.includes(provider)) {
    throw new Error(`VOICE_AI_TRANSLATE_PROVIDER "${provider}" is not one of: ${known.join(', ')}`);
  }
  const apiKey = clean(env.VOICE_AI_TRANSLATE_API_KEY);
  if (!apiKey && provider !== 'ollama') throw new Error(`VOICE_AI_TRANSLATE_API_KEY is needed for ${provider}`);
  const model = clean(env.VOICE_AI_TRANSLATE_MODEL) || (provider === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : '');
  if (!model) throw new Error(`VOICE_AI_TRANSLATE_MODEL is needed for ${provider}`);
  const baseUrl = clean(env.VOICE_AI_TRANSLATE_BASE_URL).replace(/\/+$/, '') || PROVIDER_URLS[provider] || null;
  if (provider === 'custom' && !baseUrl) throw new Error('VOICE_AI_TRANSLATE_BASE_URL is needed for a custom provider');
  return { provider, apiKey, model, baseUrl };
}

/** What is switched on, for the app to show or hide the buttons — never throws. */
export function voiceAiStatus(env = process.env) {
  const status = (read) => {
    try {
      return read(env) ? { on: true, problem: null } : { on: false, problem: null };
    } catch (err) {
      return { on: false, problem: err.message };
    }
  };
  return { transcribe: status(transcribeConfig), translate: status(translateConfig) };
}

// ------------------------------------------------------------- transcribe

const EXTENSIONS = { 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/mpeg': 'mp3', 'audio/3gpp': '3gp', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

/** Speech to text. Returns the transcript, or '' for a note with no words in it. */
export async function transcribe(buffer, mimeType, config = transcribeConfig()) {
  if (!config) throw new Error('Transcription is not set up');
  const form = new FormData();
  // The endpoint decides the format from the file NAME, so it has to carry
  // the right extension even though the bytes are the same either way.
  form.append('file', new Blob([buffer], { type: mimeType }), `voice.${EXTENSIONS[mimeType] || 'm4a'}`);
  form.append('model', config.model);
  form.append('response_format', 'json');

  const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`transcription failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const body = await response.json();
  return clean(body.text);
}

// -------------------------------------------------------------- translate

const SYSTEM = `You translate short voice messages between two partners in a private couples app. The text is a speech-to-text transcript, so it may be informal, unpunctuated or slightly misheard.

Translate it into the language the user names. Keep the tone, warmth, slang and terms of endearment; do not make it more formal. If the transcript is already in that language, return it unchanged. Reply with the translation only — no quotes, notes or explanations.`;

async function translateWithClaude(config, text, languageName) {
  // Loaded only when Claude is the chosen provider, so a broken SDK install
  // can cost translations but never stop the server starting.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    timeout: TIMEOUT_MS,
    maxRetries: 1,
  });

  const request = {
    model: config.model,
    max_tokens: 4000,
    system: SYSTEM,
    // A short, well-specified job: low effort is plenty and keeps it quick.
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Translate into ${languageName}:\n\n${text}` }],
  };

  // Straight to Anthropic, a declined request is re-run on Anthropic's
  // recommended fallback model rather than coming back empty. Through a
  // custom base URL (a proxy, a gateway) the beta may not be understood, so
  // it is left off there.
  const response = config.baseUrl
    ? await client.messages.create(request)
    : await client.beta.messages.create({
      ...request,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

  if (response.stop_reason === 'refusal') throw new Error('the model declined to translate this');
  if (response.stop_reason === 'max_tokens') throw new Error('the translation was cut off');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

async function translateWithChatApi(config, text, languageName) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Translate into ${languageName}:\n\n${text}` },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`translation failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const body = await response.json();
  return clean(body.choices?.[0]?.message?.content);
}

/** The transcript in `language` (a code from TRANSLATE_LANGUAGES). */
export async function translate(text, language, config = translateConfig()) {
  if (!config) throw new Error('Translation is not set up');
  const languageName = TRANSLATE_LANGUAGES[language];
  if (!languageName) throw new Error(`Unknown language: ${language}`);
  if (!clean(text)) return '';
  return config.provider === 'anthropic'
    ? translateWithClaude(config, text, languageName)
    : translateWithChatApi(config, text, languageName);
}
