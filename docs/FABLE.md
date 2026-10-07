# Fable: the group chat with an AI

Fable is a second chat in the app, with its own button on Home, just below
Thumb Kiss and above the call buttons. Three people are in it:

- **the two of you**, each under your own name
- **an AI model**, under whatever name you give it (Fable by default), in
  outlined bubbles with a ✦

It answers every message, or only when named (`@Fable …` or a message
starting with `Fable`). You choose which on the setup page.

Everything stays on your server. The messages, the settings and the
connections (keys included) live in the loversrock database. The phones only
talk to the loversrock backend, and the backend talks to the AI service.

```
phone ──► loversrock backend (Docker) ──► the connection you chose
          only the paired couple            Gemini, Groq, OpenRouter, NVIDIA, Mistral,
                                            OpenAI, Claude, Ollama… any address you type
```

## Connections

Fable reaches models through **connections**, the connection layer from
[Collaboration des Esprits](https://github.com/s-rakim/collaboration-des-esprits)
(`backend/src/models/aiConnections.js`). A connection is a row you define:

- a name;
- an address;
- a key;
- a model;
- the shape the endpoint speaks: OpenAI's `/chat/completions`, or Anthropic's
  `/messages` with `x-api-key`.

Presets only fill the boxes in, free tiers first. Any endpoint works under any
name, so a new provider needs no code change. Nothing is chosen for you.

**Free Claude Code** and **My Claude Code** are presets marked *when running*.
They are proxies on the PC, not services, so nothing needs them to be on: pick
them only on days you have one open. With FCC closed, Find simply says *none
of these answered*, and everything else keeps working.

## Setup (in the app, about a minute)

1. Get a key. These have free tiers:
   - **Google Gemini:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then **Create API key**.
   - **Groq:** [console.groq.com/keys](https://console.groq.com/keys).
   - **OpenRouter:** [openrouter.ai/keys](https://openrouter.ai/keys). Use models ending in `:free`.
   - **NVIDIA NIM:** [build.nvidia.com](https://build.nvidia.com).
2. In the app, open **Settings → AI chat (Fable)**, or the ⚙ at the top of
   the Fable chat.
3. Either:
   - **Paste the example.** The page where you made the key shows a code
     example (curl, Python or JavaScript). Paste all of it into **Paste the
     example** and tap **Read it**. The server reads out the address, key and
     model, checks them, and makes the result Fable's connection.
   - **Or add a connection** and pick a preset. Paste the key, or the whole
     line it was in (`"Authorization": "Bearer …",` works too). Tap **Save and
     Find**.
4. **Find** asks the service itself which address works and which models it
   really serves:
   - it repairs the address (a missing `/v1`, Google's `/v1beta/openai`);
   - it drops a model the service does not have;
   - it proves the key with a one-token call;
   - it lists the chat models to tap.
5. Tap the round button on a row to make Fable use it. **Test** on a row has
   Fable say hello through it.
6. Give it a name and a personality if you like, then tap **Save**.

Either of you can change anything; the page says who set it up last.

- **Turn off** stops Fable answering. Your connections and the chat are kept.
- **Clear chat** deletes the messages for both of you.

Keys saved under the old setup, one per provider, became connections by
themselves, with their model and (for a custom provider) their address.

### The server's own AI

If `backend/.env` has the AI connector set (`QUIZ_LLM_*`, see
[QUIZ.md](QUIZ.md)), **The server's AI** uses that instead.

### Your connection for the daily content too

With **Also write the daily content** on, Fable's connection also writes the
fresh daily quiz questions, prompts, date ideas and challenges. That only
happens while `backend/.env` has no `QUIZ_LLM_*`; the server's own setting
always wins.

## Where the keys are kept

In the `ai_connections` table, sealed with AES-256-GCM. The seal is made
from `FABLE_KEY_SECRET` in `backend/.env`, or `JWT_REFRESH_SECRET` when that
is empty. A copy of the database is therefore not a copy of your keys.

If you change that secret, the saved keys can no longer be opened. The row
then says so and asks for the key again.

The API never returns a key. A row shows the key's length and last four
characters, for example *39 characters ••••••••x9Qa*. A key cut off when it
was copied looks just like a whole one behind dots; its length is what gives
it away.

## When the chosen model is busy or gone

Free tiers are often busy ("high demand") or out of their per-minute quota,
and providers retire model names. Rather than giving up, Fable tries:

1. the chosen model, twice more a few seconds apart if it is busy;
2. up to four other chat models on the same connection (each has its own
   free quota);
3. then your other connections, each with its own model.

Whichever answers, answers.

- If the chosen model no longer exists, the connection moves onto the model
  that answered.
- **Test** says when another model or connection stood in, and why.

## When it does not answer

When nothing answers, the chat shows a red line saying why. Tapping it opens
the setup page.

| Message | Meaning |
|---|---|
| *refused the API key … sent 38 characters ending "abcd"* | The service did not accept the key. Check the length and the last four against the key on the provider's page: a short one was cut off when copied. Google says this as *400: Please pass a valid API key*. |
| *hit its limit* | Free tiers allow a few requests a minute. Wait a moment. |
| *does not know the model* | Press **Find** on the connection to pick a model it serves. |
| *has no model chosen* | Press **Find** on it. |
| *Could not reach … (DNS)* | The backend container has no internet. Check Docker's network. |

## What it knows

Each reply is written from:
- the last 30 messages, each labelled with who wrote it;
- both of your names;
- the personality you gave it.

It cannot see photos, set reminders or read anything else in the app.

## Testing

```bash
cd backend
npm run test:fable   # needs the backend running (npm start) and its database
```

This uses a stand-in AI, which refuses unknown keys the way Google does, so
no key is spent. It checks:
- connections: the key cleaned out of a pasted line, sealed, never sent back;
- Find repairing the address, listing models and proving the key;
- reading a pasted curl example, including Anthropic's shape;
- the old setup's keys becoming connections;
- who sees what;
- when the AI replies, and what it is told;
- that a refused key or a free-tier limit is explained.
