# Backgrounds

**Settings → Appearance → Background** picks what is behind every screen:

| Option | What it is |
|---|---|
| **Lava lamp** (default) | Soft colour blobs that drift and follow the tilt of the phone. |
| **Live sky** | The two of you on the bench above the Golden Gate, under the sky it is outside right now: dawn, day, sunset, a starry night and the full moon, crossing over slowly as the hours pass. The sky drifts, stars twinkle once it is dark. |
| **Timelapse** | The same scene, a whole day and night on a 24-second loop. |

The chat has the same three as wallpapers (the picture button at the top of
the chat), alongside the colours, patterns and your own photos.

## How the sky is made

`mobile/scripts/build-sky.py` builds it from the four source pictures
(kept out of the repo):

```
pip install pillow numpy imageio-ffmpeg
python3 mobile/scripts/build-sky.py <folder> --video
```

The folder holds `triptych.jpg` (day / sunset / dawn panels), `sunset.jpg`,
`night.jpg` and `moon.jpg`.

The pictures were not taken from one spot, so they are not crossfaded as
they are: that would move the couple around the screen. Instead there is one
foreground (bridge, hills, the bench and the two of you, from the day panel)
with its sky cut out, relit for each time of day, and each time of day
brings only its sky. The main cables are redrawn so they do not carry the
day's blue into the night, and the full moon is moved onto the night's moon
so the crossover reads as moonrise. It writes `mobile/assets/sky/`:
`<phase>-ground.webp`, `<phase>-sky.jpg` and `timelapse.mp4`.

The times of day are `DAY_KEYS` in `mobile/components/SkyBackground.js`.
