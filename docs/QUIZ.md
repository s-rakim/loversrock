# The daily quiz, and fresh content from an AI model

## Where the questions come from

Every day has five questions: some trivia, some "guess your partner", some
"this or that". They live in the `quiz_questions` table.

- **Built in:** 25 questions ship in `backend/seed/quiz_questions.json`. The
  backend adds them to an empty database every time it starts.
- **Recycled:** a nightly job keeps the next 14 days filled by re-using the
  bank, oldest first. So without any setup, the quiz never runs out; it just
  repeats about every five days.
- **Fresh (optional):** give the backend an AI model and it writes new
  questions for the coming week, every night.

If the quiz says **"The server has no quiz questions yet"**, the database was
never seeded. Updating the backend fixes it, because it seeds on start:

```powershell
cd docker
docker compose up -d --build
```

## Turning on fresh questions

Add four lines to `backend/.env` (the same file Docker reads), then restart
the backend.

```ini
QUIZ_LLM_PROVIDER=anthropic
QUIZ_LLM_API_KEY=your-key-here
QUIZ_LLM_MODEL=claude-haiku-4-5
QUIZ_LLM_BASE_URL=
```

| `QUIZ_LLM_PROVIDER` | Key from | Notes |
|---|---|---|
| `anthropic` | console.anthropic.com | Claude, through Anthropic's official SDK. `QUIZ_LLM_MODEL` is optional (defaults to `claude-opus-5`); `claude-haiku-4-5` is the cheapest and plenty for this. |
| `openai` | platform.openai.com | Set `QUIZ_LLM_MODEL`. |
| `gemini` | aistudio.google.com | Google's OpenAI-compatible endpoint. Set `QUIZ_LLM_MODEL`. |
| `groq` | console.groq.com | Set `QUIZ_LLM_MODEL`. |
| `openrouter` | openrouter.ai | One key for many models. Set `QUIZ_LLM_MODEL`. |
| `mistral` | console.mistral.ai | Set `QUIZ_LLM_MODEL`. |
| `deepseek` | platform.deepseek.com | Set `QUIZ_LLM_MODEL`. |
| `together` | api.together.ai | Set `QUIZ_LLM_MODEL`. |
| `ollama` | nobody: runs on your PC | Free and private. Install Ollama, pull a model, set `QUIZ_LLM_MODEL` to its name. No key. |
| `custom` | any OpenAI-compatible service | Set `QUIZ_LLM_BASE_URL` and `QUIZ_LLM_MODEL`. |

Some of these providers offer a free tier. Check the provider's own pricing
page, because those change. Ollama costs nothing at all, since the model runs
on your own machine.

Model names come from each provider's documentation. The app does not guess
them for anyone but Anthropic, because they change too often to hard-code.

### Check that it works

Before relying on the nightly job, ask for a sample. This writes nothing:

```powershell
cd docker
docker compose exec backend npm run quiz:generate -- --dry-run
```

It prints the questions it got back, or the exact error from the provider (a
wrong key, an unknown model name, a rate limit).

When that looks right, fill the coming week straight away, starting today:

```powershell
docker compose exec backend npm run quiz:generate -- --today
```

## It writes more than the quiz

The same four `QUIZ_LLM_*` lines power everything below. There is nothing
else to set up.

| What | When | Where it shows up |
|---|---|---|
| Daily quiz | nightly, 06:30 | Daily Quiz |
| Daily prompts (backup only) | nightly, 04:00 | Today's Prompt, on a day the 365-day list cannot fill |
| Deck questions (backup only) | when a deck with no questions is opened | that deck |
| Date ideas | Sundays, 05:15 | Date Ideas **and** Swipe Dates, which share one catalogue |
| Bucket-list ideas | Sundays, 05:15 | the "Ideas to add" row on the Bucket List |
| Challenges | Sundays, 05:15 | "Draw a challenge" on Home |

- **Prompts** come from our own list first: `backend/seed/daily_prompts.json`
  has 365 questions, one for each day of the year (models/promptBank.js).
  Every start and every night lays out the next month from it, and puts the
  list's question back on any upcoming day that nobody has answered yet. The
  AI (then the web pages in `PROMPT_SOURCE_URL`, then the local files) is the
  backup: it only writes a question for a day the list cannot fill.
  `ai:generate -- --only prompts` still replaces the coming week with AI ones
  on request.
- **Decks** are all seeded with at least 12 questions. The AI only writes
  some for a deck that has none, the first time it is opened.
- **Catalogues** grow by a handful a week, and never repeat an idea already
  in them. Each row is marked `source = 'ai'`, so you can always tell which
  ones came from the AI.
- **On first start** with a key, the backend does one round of everything a
  minute after starting, so you see results straight away.

To do it all now, or to check a key first:

```powershell
docker compose exec backend npm run ai:generate -- --dry-run   # show, save nothing
docker compose exec backend npm run ai:generate                # do it
docker compose exec backend npm run ai:generate -- --only prompts
```

`--only` also takes `quiz` and `catalogues`. `--today` includes today's
prompt and quiz, if nobody has started them yet.

## What it does and does not do

- **Only unstarted days.** It replaces a day only if nobody has answered any
  of that day's questions, so a question never changes under someone.
- **Only recycled days, nightly.** The nightly run (06:30) replaces days that
  are all repeats, so it never pays twice for the same day. Run it by hand
  with `--all` to replace fresh days too.
- **Checked before use.** Everything is checked before it is saved. For quiz
  questions, the checks are:
  - the right number of choices (four, or two for "this or that")
  - no duplicate choices
  - a trivia answer that is exactly one of its choices
  - nothing the bank already has

  Anything that fails is dropped, not patched.
- **Falls back on its own.** Any failure (a bad key, an outage, a refusal)
  is logged, and the recycled questions stay in place.
- **Where the key lives.** It is only ever sent to the provider you chose,
  from the backend. It never reaches the phones.

Code: `backend/src/models/quizGenerator.js`. Nightly job: `freshenQuiz` in
`backend/src/cron/index.js`. Command: `backend/scripts/generate-quiz.js`.
Test: `npm run test:quiz-generator`.
