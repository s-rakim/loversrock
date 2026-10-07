# The AI room: Collaboration des Esprits

[Collaboration des Esprits](https://github.com/s-rakim/collaboration-des-esprits)
(MIT) replaced Fable. It is a group chat for the two of you and every model
you seat in it, with a shared memory underneath: ideas, proposals the models
argue over and score, decisions with their reasons, and a board. On its
`fcc-2.0` branch, which is the one built here, the models come through
[Free Claude Code](https://github.com/Alishahryar1/free-claude-code) (FCC):
you pick them in FCC's admin page, and nothing about models or keys is set in
this app.

## How it fits together

```
phone ──/esprits (your login)──▶ backend ──Bearer token──▶ esprits :4300 ──▶ FCC on the PC :8082
                                                               ▲
browser (full pages: setup, board, work, artifacts) ───────────┘  (the room's token, once)
```

- **`docker/esprits`** builds the room from a fixed commit of the `fcc-2.0`
  branch. One process and one SQLite file, on the `espritsdata` volume.
- **Its token.** Esprits will not listen on the network without one. If
  `ESPRITS_TOKEN` is not set in `docker/.env`, the container makes one on first
  start and keeps it in the `espritssecret` volume, which the backend reads.
  The phones never get it.
- **The backend's `/esprits`** (`backend/src/routes/esprits.js`) signs each of
  you in to the room under your own name (your first name, lower case) and
  passes the call on, so nobody can post as the other, or as a model.
- **Notifications.** The backend watches the room (`models/espritsWatcher.js`):
  your partner hears when you post, and you both hear when a model replies.
  Not while you are looking at the room.
- **FCC.** The room looks for it at `http://host.docker.internal:8082/v1`
  (the PC itself) when it starts. If FCC was not running then, tap
  **Connect Free Claude Code** in the room once it is.

## Using it

- **Say something** and every model in the room answers. Tap a model's chip
  (or start with `@name`) to ask just that one.
- **Stop** appears while models are replying.
- **The bulb** drops an idea: the models ask what they need, propose ways to
  do it and score each other's proposals, and you choose.
- **The globe** opens the room's own pages in the browser: setup (seats,
  connections, Telegram), the board, swarm work, artifacts. They ask for the
  room's token once per browser:

  ```powershell
  cd C:\Users\USER\Documents\loversrock\docker
  docker compose exec esprits cat /secret/token
  ```

## Setup on the PC

1. Run Free Claude Code (`fcc-server`, or its app) and pick your models at
   `http://127.0.0.1:8082/admin`.
2. `cd docker; docker compose up -d --build`.
3. Open the room in the app (Home → Esprits). If it says FCC is not
   connected, tap **Connect Free Claude Code**.

If Connect says FCC is not answering although it is running, FCC is probably
only listening on 127.0.0.1, where a container cannot reach it. Start it
listening on all interfaces, or point the room elsewhere with **It is
somewhere else** (or `ESPRITS_FCC` in `docker/.env`).

## Daily content

The daily prompts, quiz questions and date ideas use backend/.env's
`QUIZ_LLM_*` when it names a model. Otherwise they now go through FCC too
(`FCC_URL`, set by docker-compose to the PC): FCC speaks Anthropic's
`/v1/messages`, so it is the `anthropic` provider at FCC's address, no key
needed (`FCC_TOKEN` only if FCC's proxy authentication is on). The 365-day
prompt bank still comes first; a model is the backup.

## What happened to Fable

Its screens and routes are gone. Its tables (`fable_settings`, `ai_keys`,
`fable_messages`) are left in the database untouched, so the old chat and
saved keys are not deleted by an update; drop them by hand when you no longer
want them.

## Privacy

The room is not end-to-end encrypted (the chat with your partner is).
Esprits keeps everything said in it, and every key pasted into its setup
page, in its SQLite file on the PC. A model's reply goes into the
notification. There is one room per server: anyone paired on this server who
opens it is in the same room.

## Tests

`backend/test/esprits.mjs` (31) runs against a real Esprits with a stand-in
for FCC: names, the token staying on the server, content through FCC, who
gets notified, and posting, reading, ideas, stop and connect through the
backend, with the models really answering.
