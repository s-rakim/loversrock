# Backgrounds

**Settings → Appearance → Background** picks what is behind every screen:

| Option | What it is |
|---|---|
| **Lava lamp** (default) | Soft colour blobs that drift and follow the tilt of the phone. |
| **Golden Gate** | The two of you on a bench above the Golden Gate, under the sky it is outside right now. |
| **New York** | The same bench and the same two, on a promenade across the river from the Manhattan skyline, under the same sky. The windows light up as it gets dark, and the river reflects the city. |
| **Golden Gate timelapse** / **New York timelapse** | Each scene through a whole day and night, on a slow loop of about a minute. |

The live skies go through dawn, day, sunset, the blue hour, a starry night
and the full moon. The light changes slowly, taking an hour or two to go from
one to the next. There is a picture for every 20 minutes while it is
changing, and the app glides evenly from each picture to the next over those
20 minutes, so it never visibly steps. The sky drifts, and stars come out as
it darkens.

The two of you are a silhouette: one dark shape, with no skin or hair colour.

The chat has the same five as wallpapers (the picture button at the top of
the chat), alongside the colours, patterns and your own photos.

## How the skies are made

`mobile/scripts/build-sky.py` builds everything from the four source
pictures (kept out of the repo):

```
pip install pillow numpy imageio-ffmpeg
python3 mobile/scripts/build-sky.py <folder> --video
```

The folder holds `triptych.jpg` (day / sunset / dawn panels), `sunset.jpg`,
`night.jpg` and `moon.jpg`.

**One foreground.** The pictures were not taken from one spot, so they are
not crossfaded as they are: that would move the couple around the screen.
Instead the foreground is the day panel (bridge, hills, the bench) with its
sky cut out, relit for each light. Each light brings only its own sky.

- The main cables are redrawn so they do not carry the day's blue into the night.
- The night and full-moon pictures share their stars, so the night's small moon is moved onto the full moon. Moonrise is the moon swelling in place.
- The blue hour has no picture of its own; it is made from the sunset's clouds.

**The silhouette.** The couple is traced by hand (`COUPLE_OUTLINE`),
smoothed, and filled with one dark tone.

**New York.** The skyline is drawn by the script, at twice the size and then
scaled down:

- One World Trade, the Empire State and the Chrysler crown among rows of blocks, with windows that light up.
- The river, which reflects the city and its lights.
- A promenade railing.

The bench and the silhouette come from the Golden Gate foreground.

**The pictures.** `SCHEDULE` in the script says how much of each light there
is through the day. The script renders a picture every 20 minutes wherever
that changes (33 of them). Each is its own mix: the sky's colour blends
evenly, but the clouds and stars hand over faster in the middle, so no
picture shows two skies at once. The skies are shared by both scenes; each
scene has its own foreground per picture.

The script writes:

- `mobile/assets/sky/NN-sky.jpg`, the skies
- `mobile/assets/sky/<scene>/NN.webp`, each scene's foregrounds
- `mobile/assets/sky/timelapse-<scene>.mp4`, rendered from the same schedule frame by frame
- `mobile/components/skyFrames.js`, which lists the pictures and the timeline

To change the times, edit `SCHEDULE` and run the script again. Don't edit
`skyFrames.js` by hand.
