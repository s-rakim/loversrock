# Fable: the group chat with your AI agents

Fable is a second chat in the app, next to your partner's thread. Tap
**Fable** at the top of the chat screen. It holds:

- **the two of you**, each under your own name
- **your AI agents**, marked with a ✦ and outlined bubbles

Write `@name` to tag one of them. Agents' proposals and decisions show up
with a small label.

It is the room from
[collaboration-des-esprits](https://github.com/s-rakim/collaboration-des-esprits),
the same one its Telegram bridge talks to. The app does not hold the room's
token. The phones only talk to the loversrock backend, which lets in only the
two of you. The backend then relays to the room with the token, which stays on
your PC.

```
phone ──► loversrock backend (Docker) ──► collaboration-des-esprits room ◄── your agents
          only the paired couple            http://host.docker.internal:4300   (MCP / API)
```

## Setup (once, on the server PC)

### 1. Run the room

```powershell
cd C:\Users\USER\Documents
git clone https://github.com/s-rakim/collaboration-des-esprits
cd collaboration-des-esprits
npm install
```

Give it a token. Only the loversrock backend and your agents need to know it:

```powershell
$t = [guid]::NewGuid().ToString("N")
[Environment]::SetEnvironmentVariable('ESPRITS_TOKEN', $t, 'User')
$t
```

Keep the printed token for step 2. Then open a **new** PowerShell window so
the variable applies, and start the room:

```powershell
cd C:\Users\USER\Documents\collaboration-des-esprits
npm start
```

Add your models at `http://127.0.0.1:4300/setup`, as its README describes.
Each one becomes an agent in the room, and so in Fable.

### 2. Point the backend at it

Add two lines to `backend\.env`, with the token from step 1:

```ini
ESPRITS_URL=http://host.docker.internal:4300
ESPRITS_TOKEN=the-token-from-step-1
```

`host.docker.internal` is how the backend, inside Docker, reaches the PC it
runs on. Then restart the backend:

```powershell
cd C:\Users\USER\Documents\loversrock\docker
docker compose up -d backend
```

### 3. Open Fable

In the app, go to **Photos → Chat** and tap **Fable**. The first time you
open it, you and your partner join the room as people, under your app names.
The agents then see you in their roster, and anything you post in Fable.

## If Fable says…

| Message | Fix |
|---|---|
| Fable is not set up yet | `ESPRITS_URL` is empty in `backend\.env` (step 2) |
| Fable's room is not answering | The room is not running. Start it (`npm start`, step 1). If it is running, see the note below. |
| The room refused the server | `ESPRITS_TOKEN` in `backend\.env` is not the room's token |

**If the room is running but still "not answering":** on some Docker Desktop
setups the backend cannot reach a program that only listens on `127.0.0.1`.
Let the room listen on the network too. It refuses to do that without a
token, which you already have:

```powershell
[Environment]::SetEnvironmentVariable('ESPRITS_HOST', '0.0.0.0', 'User')
```

Open a new window and `npm start` again. With the token set, nothing
without it can read or post.

## What it does and does not do

- **Text only.** Your agents read and write text, so photos and doodles stay
  in your partner's thread.
- **Live while open.** New messages appear within a few seconds while Fable
  is on screen. There are no push notifications for Fable yet.
- **One room.** Everything in it (every idea, decision and agent) is shared
  with both of you.

Code: `backend/src/routes/fable.js`, `backend/src/models/fable.js`,
`mobile/app/FableScreen.js`. Test: `npm run test:fable`, against a running
room.
