# Fable: the group chat with an AI

Fable is a second chat in the app, with its own button on Home, just below
Thumb Kiss and above the call buttons. Three people are in it:

- **the two of you**, each under your own name
- **an AI model**, under whatever name you give it (Fable by default), in
  outlined bubbles with a ✦

It answers every message, or only when named (`@Fable …` or a message
starting with `Fable`). You choose which on the setup page.

Everything stays on your server. The messages, the settings and the API keys
live in the loversrock database. The phones only talk to the loversrock
backend, and the backend talks to the AI provider.

```
phone ──► loversrock backend (Docker) ──► the AI provider you chose
          only the paired couple            Gemini, Groq, OpenRouter, OpenAI, Claude, Ollama…
```

## Setup (in the app, about a minute)

1. Get an API key. These have free tiers:
   - **Google Gemini:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then **Create API key**.
   - **Groq:** [console.groq.com/keys](https://console.groq.com/keys).
   - **OpenRouter:** [openrouter.ai/keys](https://openrouter.ai/keys). Use models ending in `:free`.
2. In the app, open **Settings → AI chat (Fable)**, or the ⚙ at the top of
   the Fable chat.
3. Under **Who answers**, pick **My own API key**, then pick the provider.
4. Paste the key and tap **Save key**. The key is sent once and sealed on the
   server. After that the page only ever shows its last four characters.
5. Pick a model. Once a key is saved, the page asks the provider which chat
   models that key can use today and lists them, best first: tap one. You
   can still type any other name.
6. Give it a name and a personality if you like, then tap **Test**. You should
   get a one-line hello back.
7. Tap **Save**.

You can save a key for several providers and switch between them. Either of
you can change anything; the page says who set it up last. **Turn off** stops
it answering and keeps the keys and the chat. **Clear chat** deletes the
messages for both of you.

### The server's own AI

If `backend/.env` has the AI connector set (`QUIZ_LLM_*`, see
[QUIZ.md](QUIZ.md)), **The server's AI** uses that instead of a key of your
own.

### Your key for the daily content too

With **Also write the daily content** on, a key you add here also writes the
fresh daily quiz questions, prompts, date ideas and challenges. That only
happens while `backend/.env` has no `QUIZ_LLM_*`; the server's own setting
always wins.

## Where the keys are kept

In the `ai_keys` table, sealed with AES-256-GCM. The seal is made from
`FABLE_KEY_SECRET` in `backend/.env`, or `JWT_REFRESH_SECRET` when that is
empty. A copy of the database is therefore not a copy of your keys. If you
change that secret, the saved keys can no longer be opened. The setup page
then says so and asks for them again.

The API never returns a key, only a hint like `…a1b2`.

## When the chosen model is busy or gone

Free tiers are often busy ("high demand") or out of their per-minute quota,
and providers retire model names. Rather than giving up, Fable tries:

1. the chosen model, twice more a few seconds apart if it is busy;
2. up to four other chat models from the same provider (each has its own
   free quota);
3. then your other saved keys, each with its best model.

Whichever answers, answers. If the chosen model no longer exists, the setup
moves onto the one that answered. **Test** says when another model stood in,
and offers a button to switch to it.

## When it does not answer

When nothing answers, the chat shows a red line saying why, and tapping it
opens the setup page.

| Message | Meaning |
|---|---|
| *refused the API key* | The key is wrong or was deleted. Paste it again. |
| *limit was reached* | Free tiers allow a few requests a minute. Wait a moment. |
| *does not know the model* | Pick another model on the setup page. |
| *is a text-to-speech model* | Use a plain chat model (for Gemini, one ending in `-flash`). |
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

This uses a stand-in AI, so no key is spent. It checks:
- the keys are sealed and never sent back;
- who sees what;
- when the AI replies, and what it is told;
- that a refused key or a free-tier limit is explained.
