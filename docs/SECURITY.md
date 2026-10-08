# Security

What the security audit found, and what was done about each item.
`backend/test/security.mjs` checks the fixes against a live backend.

## Do this once on the server PC

```powershell
cd C:\Users\USER\Documents\loversrock
git pull
node docker/secure-setup.mjs
```

The script needs only Node and Docker Desktop. It does all of this:

- writes strong random secrets into `backend/.env` and `docker/.env`;
- changes the database and storage passwords in place;
- rebuilds and restarts everything.

It never prints a secret, and it is safe to run again. Afterwards, both of you
sign in to the app once more. AI keys saved in Fable are kept.

## The findings

| # | Finding | Now |
|---|---|---|
| 1 | Database and storage open to the network with default passwords | Bound to `127.0.0.1` (this PC only); passwords changed by the setup script |
| 2 | Server ran on the example login secrets | Refuses to start on a placeholder, empty or short secret, and names the fix (`backend/src/config/secrets.js`) |
| 3 | Any account could open any photo | `/media` serves only your current pair's files (and your own or your partner's mascot). Sign-ups close once a couple is paired (`SIGNUPS=auto`) |
| 4 | No limit on guessing | 8 wrong passwords per account per 15 minutes; 10 wrong invite codes; per-address limits too. Invite codes are 10 characters and last a day |
| 5 | One-character passwords | At least 8 characters |
| 6 | Logins could not be revoked | Refresh tokens are recorded. Logging out ends one; changing your password or "Sign out everywhere else" ends all (Settings → Password and sign-ins) |
| 7 | Partner keys trusted blindly | The first key is remembered. A changed key blocks sending until you check it. Settings → Encryption shows the safety number |
| 8 | "End-to-end encrypted" claimed too much | The chat now says texts, polls and places are encrypted, and photos and voice notes are not. Settings → Encryption lists it all |
| 9 | Public default TURN secret | No default: compose refuses to start without one, and the backend refuses a weak one |
| 10 | Ex-partner kept live updates after unlinking | Both phones' live connections are dropped at unlink |
| 11 | Plain HTTP on home Wi-Fi | The server address setting warns when an address is not a Tailscale one |
| 12 | Login token in photo links | Photo links carry a photo-only token (12 hours, your own pair's pictures only) |
| 13 | Call server had no login | It admits a phone to a room only with a pass the backend signed for that call (`CALLS_SECRET`) |
| 14 | Fable could be pointed at the PC's services | Connections to the other containers and to the database, storage, call and backend ports are refused |
| 15 | Uploads not checked to be images | The bytes are checked (JPEG, PNG, GIF, WebP, HEIC, AVIF, BMP), and files are served with `nosniff` |
| 16 | One secret, several jobs | Signed links each use a key derived for their purpose (`LINK_SECRET`). AI keys have their own seal (`FABLE_KEY_SECRET`); changing it re-seals saved keys from `FABLE_KEY_SECRET_OLD` |
| 17 | Dependencies | Backend: firebase-admin 14 and node-cron 4 (Node 22 image). The high advisories are gone. Four moderate ones remain inside the MinIO client, which only talks to your own storage |

## Still open

- **Photos and voice notes are not end-to-end encrypted.** They are readable
  on the PC, which only the two of you can sign in to.
- **The app's dependency advisories are almost all in build tools on the
  PC**, not in what the phones run. Clearing them means the next Expo SDK
  upgrade.
