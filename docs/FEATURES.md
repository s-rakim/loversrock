# Candle + Lovers X feature map

Every feature from the Candle / Lovers X brief, where it lives, and what to
know about it. Everything here was added **alongside** the original app —
no existing screen, route or behaviour was removed or rewritten.

## The couple's characters (mascots)

| | |
|---|---|
| What | Two live **3D** characters — you and your partner — drawn from the couple's photo: her high puff, green fitted top, jeans, sneakers and gold hoops; his twists, blue football jersey, cargo shorts, tall white socks, teal slides and microphone. |
| Where | Loading screen, top of Home, profiles, onboarding, Wardrobe, Who's More Likely, mood picker. |
| Live | Breathe, blink, bob, sway (so the 3D reads), act out a mood with pose + face + motion (cheer, hands-on-heart, hands-on-hips, droop, hug, …). Tap: wave + spin. |
| Mood | On **your** phone your partner's character wears **their** mood and yours wears yours; the same on theirs. Updates live over the socket the moment either of you sets a mood. |
| Wardrobe | Skin tone, 8 hairstyles + colour, 7 tops, 5 bottoms, 5 shoes (+ tall socks), 10 accessories, all recolourable. Saved to the account (`users.avatar`) so the partner sees it. |
| Scale | Sized per screen (`components/avatar/sizing.js`) and always the **same height** as each other. |
| Code | `components/avatar3d/` (three.js on `expo-gl`), `components/Mascot.js`, `components/avatar/wardrobe.js`. If a phone can't create a GL context the app falls back to the 2D drawing in `components/avatar/Avatar.js` automatically. |

## Candle

| # | Feature | Where |
|---|---|---|
| 1 | Couple pairing | existing (`PairingScreen`, `/auth/invite`) |
| 2 | Daily questions (reveal after both) | existing `DailyPromptScreen`; now also nudges the partner and earns Sparks |
| 3 | Question decks | existing decks + **Connect** screen; seasonal decks (Valentine's, Spring, Summer, Autumn, Halloween, Holidays, New Year) appear only in season |
| 4 | Adaptive questions | "Skip" on any question; **For you** in Connect weights categories by (answers + 1) / (skips + 1) and never re-shows a skip |
| 5 | Daily Snap | `DailySnapScreen` (camera or library), history, partner push, Sparks; still feeds the photo widget |
| 6 | Photo captions | Daily Snap, Memories (caption before upload), Feed |
| 7 | Thumb Kiss | existing; plus "Thumb Kiss invite" nudges and a Quick Kiss widget |
| 8 | Shared Canvas | `SharedCanvasScreen`: live for both, pen/eraser/**eyedropper**, 13 colours, 4 brush sizes, **zoom 1–3× + pan**, undo (own strokes), paper colours |
| 9 | Canvas Gallery | `CanvasGalleryScreen`: save, restore onto the canvas, delete |
| 10 | Couple games | existing 7 + **Who's More Likely** (50 prompts, reveal after both) + **Chess** (server-validated, full rules) |
| 11 | Achievements | 20 badges with progress bars; Sparks paid once to both |
| 12 | Streaks | existing |
| 13 | Streak protection / restore | Streak freezes (bank up to 3) cover missed days automatically; a broken streak can be bought back within 3 days |
| 14 | Sparks | ledger-based currency: earn (answers, snaps, check-ins, challenges, posts, achievements, welcome bonus), gift to partner, spend on freezes, restores, decks, premium dates, game hints |
| 15 | Date ideas | 62 ideas (12 premium), **20 per week** rotating, tailored to city / suburbs / countryside / long-distance, swipe cards |
| 16 | Date matching | both swipe right → "It's a match!" + push |
| 17 | Date scheduling + statuses | idea → planned → confirmed → done / cancelled |
| 18 | Bucket list | existing |
| 19 | Monthly check-ins | 5 heart ratings + 4 open questions, revealed after both; history with averages; reminder on the 1st |
| 20 | Memories calendar | `TimelineScreen`: photos, snaps, posts, dates, bucket wins, challenges, drawings, achievements, check-ins, countdowns by day |
| 21 | Notes | shared, colour-coded, pinnable; newest feeds the Love Note widget |
| 22 | Chat | existing + reply-to, emoji reactions, your messages on the right |
| 23–25 | Widgets, countdowns, distance | see `docs/WIDGETS.md` — 12 new widgets |
| 26 | Random challenge | 40 challenges, same for both each day, 3 rerolls; "can't decide?" dice picks a challenge, date, game or deck |
| 27 | Notifications | 13 categories, each switchable in Settings → Notifications; taps open the right screen |
| 28 | Seasonal content | seasonal decks (above) |
| 29 | Multi-language | English, Français, Español, Deutsch (Settings → Language). Covers the new screens, tab bar and Settings additions; the original screens and server-side content (questions, date ideas) are still English |
| 30 | Private, ad-free | unchanged: self-hosted, Tailscale, no ads |
| — | Onboarding | name/birthday/character/relationship type/anniversary/goals/daily time/how you found us/notifications, then "Tailoring your journey…" |
| — | Paywall | not applicable (free, self-hosted); the Sparks shop uses the same feature-carousel presentation |

## Lovers X

| Feature | Where |
|---|---|
| Private couple space / joint feed | **Feed** tab (`/feed`) |
| Memories (photo posts) | Feed posts with photos; also on the calendar |
| Likes + love reactions | separate 👍 / ❤️ toggles with counts |
| Comments | per post, live |
| Mood + mood notifications | mood picker (Home, Profile); partner gets a push unless they muted "Mood changes" |
| Partner profiles | `ProfileScreen`: character in current mood, bio, birthday, love language, favourites, their posts |
| Relationship memories / couple-only | all data is pair-scoped (`docs/SPEC.md` #3) |

## Known limits

- **Nothing native has been compiled** (widgets, 3D on device) — same situation
  as the original widgets; `expo prebuild` was run and the output inspected.
  The 3D characters were rendered through WebGL in a browser with the exact
  same scene code to check them, not on a phone.
- **iOS push** needs the Firebase iOS SDK (FCM rejects raw APNs tokens); Android
  works with the existing FCM setup.
- Screen titles pick up a language change on the next launch.
