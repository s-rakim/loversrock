# Backgrounds

**Settings → Appearance → Background** picks what is behind every screen.
Five quick picks are buttons there; **All wallpapers, colours and photos**
opens the wallpaper picker on **Whole app**, where every wallpaper can go
behind every screen: these five, the colours and patterns, and your own
photos from Memories. The same picker, switched to **Chat**, sets the chat's
wallpaper (the picture button at the top of the chat opens it there). With
the chat on **None**, the chat shows the app's background too.

| Option | What it is |
|---|---|
| **Lava lamp** (default) | Soft colour blobs that drift and follow the tilt of the phone. |
| **Golden Gate** | The two of you on a bench above the Golden Gate, under the sky it is outside right now. |
| **New York** | The two of you on a bench across the river from Lower Manhattan, with its own sunset and dawn colours. The river takes the colour of the sky, the windows light up as it gets dark, and the river carries their reflections. |
| **Golden Gate timelapse** / **New York timelapse** | Each scene through a whole day and night, on a slow loop of about a minute and a half. |

The live skies go through dawn, the morning, noon, the golden afternoon,
sunset, the blue hour, a starry night, moonrise and moonset. The light never
stands still, and takes an hour or two to go from one light to the next.
There is a picture for every 20 minutes of the day (72 a scene), and the app
glides evenly from each picture to the next over those 20 minutes, so it
never visibly steps. The sky drifts, and stars come out as
it darkens.

The two of you are a silhouette: one dark shape, with no skin or hair colour.

The app background is kept on each phone; the chat's wallpaper is kept on
your account, so it follows you to a new phone.

## How the skies are made

`mobile/scripts/build-sky.py` builds everything from the five source
pictures (kept out of the repo):

```
pip install pillow numpy imageio-ffmpeg
python3 mobile/scripts/build-sky.py <folder> --video
```

The folder holds:

- `triptych.jpg`: the Golden Gate day, sunset and dawn panels
- `sunset.jpg`: a wide Golden Gate sunset
- `night.jpg` and `moon.jpg`: the starry night and the full moon, shared by both scenes
- `newyork.jpg`: the New York day, sunset and dawn panels

**One foreground.** A scene's pictures were not taken from one spot, so
they are not crossfaded as they are: that would move the couple around the
screen. Instead each scene's foreground is its day panel with the sky cut
out, relit for each light. Each light brings only its own sky.

- The main cables are redrawn so they do not carry the day's blue into the night.
- The night and full-moon pictures share their stars, so the night's small moon is moved onto the full moon. Moonrise is the moon swelling in place.
- The blue hour has no picture of its own; it is made from the sunset's clouds.

**The silhouette.** In each scene the couple is traced by hand
(`COUPLE_OUTLINE`, `NY_OUTLINE`), smoothed, and filled with one dark tone.

**New York.** The skyline is cut from its sky column by column: the script
walks down each column, following the sky's colour, and takes the first
place the picture leaves it for good as the top of a building. That works
even for glass towers that mirror the sky. New York's day, sunset and dawn
skies come from its own panels, measured only where they are sky. At night a
scatter of windows lights up on each building, and the river reflects them.
The river also takes the colour of the sky above it.

**The pictures.** `SCHEDULE` in the script says how much of each light there
is through the day. The script renders a picture every 20 minutes (72 of
them). Each is its own mix: the sky's colour blends
evenly, but the clouds and stars hand over faster in the middle, so no
picture shows two skies at once. Each scene has its own sky and foreground
per picture.

The script writes:

- `mobile/assets/sky/<scene>/NN-sky.jpg` and `NN-ground.webp`, each scene's skies and foregrounds
- `mobile/assets/sky/timelapse-<scene>.mp4`, rendered from the same schedule frame by frame
- `mobile/components/skyFrames.js`, which lists the pictures and the timeline

To change the times, edit `SCHEDULE` and run the script again. Don't edit
`skyFrames.js` by hand.
