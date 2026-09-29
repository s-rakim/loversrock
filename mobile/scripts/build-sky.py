#!/usr/bin/env python3
"""Builds the live-sky background (components/SkyBackground.js) and the
timelapse loop from the Golden Gate pictures.

    python3 scripts/build-sky.py <folder with the four pictures> [--video]

The pictures (kept out of the repo; only what this makes is committed):
    triptych.jpg  three framed portrait panels: day, sunset, pink dawn
    sunset.jpg    wide sunset
    night.jpg     wide starry night
    moon.jpg      wide night with the full moon

Why it is built this way. The pictures were not taken from one spot: the
panels put the couple beside the tower, the wide shots put them far to the
right. Crossfading them would move the couple around the screen. So there is
ONE foreground (the day panel: bridge, hills, water, the two of you on the
bench) with its sky cut out, relit for each time of day, and each time of
day brings only its SKY from its own picture. Nothing in the scene moves
between phases; only the light changes, and the sky can drift on its own.

Makes, in assets/sky/:
    <phase>-ground.webp   the foreground, relit, transparent where the sky is
    <phase>-sky.jpg       that phase's sky, wider than the screen so it can drift
and, with --video, assets/sky/timelapse.mp4 (and a copy next to the inputs).
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

W, H = 624, 1200          # the foreground; about a phone's shape
SKY_W, SKY_H = 1040, 760  # each sky: wider than the screen, for drifting
HORIZON = 690             # the sky never reaches below this row
TOWER_X = (314, 378)      # the tower's columns in the foreground
MOON_SHIFT = (62, 51)     # full moon (952,157) onto the night's moon (890,106)
PHASES = ['dawn', 'day', 'sunset', 'night', 'moon']

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'sky')


def load(path):
    return Image.open(path).convert('RGB')


def arr(img):
    return np.asarray(img).astype(np.float32)


def img(a, mode='RGB'):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode)


# ------------------------------------------------------------------ inputs

def panels(tri):
    """The three portrait panels, inside their frames, cropped alike."""
    def crop(x0):
        # Inside the dark frame; the bottom stops above the watermark.
        return tri.crop((x0 + 37, 19, x0 + 37 + 349, 690)).resize((W, H), Image.LANCZOS)
    return crop(20), crop(492), crop(964)


def sky_mask(day):
    """1 where the day picture is sky, feathered at the edges.

    Sky is anything bluer than it is red above the horizon. The bridge's
    towers and cables are red, so they stay in the foreground — with a pixel
    of margin, or the thin cables break up into dashes where JPEG has smeared
    them into the blue.
    """
    a = arr(day)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    sky = (b - r > 12) & (b > 110)
    # Red, not merely warm: the haze above the city is pale, not red.
    # Red, not merely warm: the haze above the city is pale, not red. The
    # main cables are too thin and too blended into the blue to cut out
    # cleanly — they would carry the day's sky with them into the night — so
    # they go with the sky here and are drawn back, clean, by draw_cables().
    cable = (r - g > 20) & (r - b > -60)
    cable = arr(img(cable.astype(np.float32) * 255, 'L').filter(ImageFilter.MaxFilter(3))) > 0
    sky &= ~cable
    # Above the horizon the only thing standing is the tower: everything else
    # up there (the far span's cables, a few birds) goes with the sky, or it
    # would hang in the night sky in daylight colours.
    tower = np.zeros_like(sky)
    tower[:, TOWER_X[0]:TOWER_X[1]] = True
    sky[:HORIZON - 12, :] |= ~tower[:HORIZON - 12, :]
    sky[HORIZON:, :] = False
    m = img(sky.astype(np.float32) * 255, 'L')
    # Close pinholes (JPEG noise) without eating into the bridge.
    m = m.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    m = m.filter(ImageFilter.GaussianBlur(0.9))
    return arr(m) / 255.0


# ------------------------------------------------------------------ skies

def extend_vertically(tex, height, anchor='bottom'):
    """Pads a sky texture to `height` by repeating its edge row, softly."""
    h = tex.shape[0]
    if h >= height:
        return tex[-height:] if anchor == 'bottom' else tex[:height]
    pad = height - h
    if anchor == 'bottom':   # the texture sits on the horizon; extend upwards
        # The top row, smoothed sideways, so the padding is a clean gradient
        # rather than a row of pixels stretched into streaks.
        edge = arr(img(tex[:1]).resize((tex.shape[1], 1)).filter(ImageFilter.GaussianBlur(40)))
        top = np.repeat(edge, pad, axis=0)
        return np.concatenate([top, tex], axis=0)
    bottom = np.repeat(tex[-1:], pad, axis=0)
    return np.concatenate([tex, bottom], axis=0)


def gradient_to(tex, height, bottom_colour):
    """Below a texture, blends from its last row into `bottom_colour` at the horizon."""
    h = tex.shape[0]
    pad = height - h
    if pad <= 0:
        return tex[:height]
    last = tex[-1:].mean(axis=1, keepdims=True).repeat(tex.shape[1], axis=1)
    t = np.linspace(0, 1, pad)[:, None, None]
    fill = last * (1 - t) + np.array(bottom_colour, np.float32)[None, None, :] * t
    return np.concatenate([tex, fill.astype(np.float32)], axis=0)


def fit_width(a, width):
    im = img(a)
    h = round(im.height * width / im.width)
    return arr(im.resize((width, h), Image.LANCZOS))


def mirror_tile(strip, width):
    """A strip of sky with no tower in it, mirrored until it is `width` wide."""
    out = strip
    flip = False
    while out.shape[1] < width:
        piece = strip[:, ::-1] if not flip else strip
        out = np.concatenate([out, piece], axis=1)
        flip = not flip
    return out[:, :width]


def clean_strip(a):
    """A strip of sky with the far span's cables (and birds) painted out.

    Anything thin that stands out from the sky around it — darker, or
    redder — is replaced by the sky around it. Clouds are soft and wide, so
    a median over a small window keeps them.
    """
    out = a.copy()
    # Twice: the first pass takes the lines, the second their faint halo.
    for size, limit in ((9, 10), (15, 4)):
        smooth = arr(img(out).filter(ImageFilter.MedianFilter(size)))
        lum = out.mean(axis=2)
        lum_s = smooth.mean(axis=2)
        warm = (out[..., 0] - out[..., 2]) - (smooth[..., 0] - smooth[..., 2])
        odd = (np.abs(lum - lum_s) > limit) | (warm > limit)
        odd[: HORIZON // 2] &= np.abs(lum - lum_s)[: HORIZON // 2] > 10   # high sky: only the obvious
        odd = arr(img(odd.astype(np.float32) * 255, 'L').filter(ImageFilter.MaxFilter(5))) > 0
        out[odd] = smooth[odd]
    return out


def build_skies(day, dawn, sunset_w, night_w, moon_w, mask):
    skies = {}
    height = SKY_H

    # Day: the day panel's own sky, left of the tower, mirrored wide.
    d = clean_strip(arr(day)[:HORIZON, :250])
    skies['day'] = fit_height(mirror_tile(d, SKY_W), height)

    # Dawn: the pink panel's clouds, the same way (no tower in the strip).
    p = clean_strip(arr(dawn)[:HORIZON, :250])
    skies['dawn'] = fit_height(mirror_tile(p, SKY_W), height)

    # Sunset: the wide picture's sky above the hills, sitting on the horizon.
    s = arr(sunset_w)[:385, :690]          # left of the tower, above the hills
    s = fit_width(s, SKY_W)
    skies['sunset'] = extend_vertically(s, height, anchor='bottom')

    # Night and moon: the top of the wide pictures — stars, the Milky Way,
    # the moon — which is all above the tower, scaled to fill the sky, with a
    # soft fall into the city's glow at the horizon.
    # The full moon sits a little right and below the night's small moon in
    # the pictures; moved onto it, the crossfade reads as the moon swelling
    # and brightening in place instead of a second moon appearing.
    moon_w = moon_w.crop((MOON_SHIFT[0], MOON_SHIFT[1], moon_w.width, moon_w.height))
    for key, src, glow in (('night', night_w, (40, 44, 70)), ('moon', moon_w, (52, 60, 88))):
        n = arr(src)[:300]
        im = img(n)
        scale = (HORIZON + 10) / im.height
        big = arr(im.resize((round(im.width * scale), HORIZON + 10), Image.LANCZOS))
        centre = int(820 * scale)                     # the moon, a little left of it
        x0 = max(0, min(big.shape[1] - SKY_W, centre - SKY_W // 2))
        big = big[:, x0:x0 + SKY_W]
        # The lowest third eases into the glow above the city.
        rows = big.shape[0]
        t = np.clip((np.arange(rows) - rows * 0.62) / (rows * 0.38), 0, 1) ** 1.5
        big = big * (1 - t[:, None, None]) + np.array(glow, np.float32) * t[:, None, None]
        skies[key] = extend_vertically(big, height, anchor='top')
    return skies


def fit_height(a, height):
    im = img(a)
    w = round(im.width * height / im.height)
    im = im.resize((w, height), Image.LANCZOS)
    if w < SKY_W:
        im = im.resize((SKY_W, height), Image.LANCZOS)
    return arr(im)[:, :SKY_W]


# ---------------------------------------------------------------- grounds

def grade(a, phase):
    """The one foreground, relit for a time of day."""
    lum = a[..., :1] * 0.299 + a[..., 1:2] * 0.587 + a[..., 2:3] * 0.114
    if phase == 'day':
        return a
    if phase == 'dawn':
        # Soft pink morning light, a little lower.
        return a * np.array([0.92, 0.80, 0.86]) + np.array([14, 4, 12])
    if phase == 'sunset':
        warm = a * 0.55 + lum * 0.25
        return warm * np.array([1.05, 0.66, 0.46])
    if phase == 'night':
        return lum * np.array([0.16, 0.19, 0.30]) + np.array([2, 3, 8])
    if phase == 'moon':
        return lum * np.array([0.24, 0.27, 0.38]) + np.array([4, 5, 12])
    raise ValueError(phase)


def city_lights(day, mask):
    """Warm points where the far-off city is, lit at night."""
    a = arr(day)
    lum = a.mean(axis=2)
    band = np.zeros_like(lum, bool)
    band[HORIZON - 25:HORIZON + 40, :] = True
    lights = band & (lum > 190) & (mask < 0.2)
    rng = np.random.default_rng(7)
    lights &= rng.random(lights.shape) < 0.5
    glow = img(lights.astype(np.float32) * 255, 'L').filter(ImageFilter.GaussianBlur(1.3))
    return arr(glow)[..., None] / 255.0


def tower_top(day):
    """Where the aircraft lights go: the tallest red column near the middle."""
    a = arr(day)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 120) & (r > g * 1.7) & (r > b * 1.7)
    red[:, :W // 4] = False
    red[:, 3 * W // 4:] = False
    cols = red.sum(axis=0)
    x = int(cols.argmax())
    ys = np.where(red[:, max(0, x - 3):x + 4].any(axis=1))[0]
    return x, int(ys.min()) if len(ys) else 520


# The main cables, measured off the day picture: from the tower top down to
# either edge, sagging towards the middle of the span beyond the frame.
CABLES = [
    ((323, 531), (0, 694)),
    ((325, 541), (0, 716)),
    ((369, 529), (W, 671)),
    ((367, 540), (W, 690)),
]
CABLE_COLOUR = {
    'day': (176, 58, 48), 'dawn': (168, 72, 70), 'sunset': (74, 32, 28),
    'night': (22, 22, 32), 'moon': (34, 34, 48),
}


def draw_cables(ground, phase):
    """Adds the cables to a relit foreground, antialiased (drawn at 4x)."""
    from PIL import ImageDraw
    k = 4
    layer = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    colour = CABLE_COLOUR[phase] + (255,)
    for (x0, y0), (x1, y1) in CABLES:
        pts = []
        for i in range(81):
            t = i / 80
            # Steep by the tower, flattening towards the middle of the span.
            y = y0 + (y1 - y0) * (2 * t - t * t)
            x = x0 + (x1 - x0) * t
            pts.append((x * k, y * k))
        d.line(pts, fill=colour, width=int(2.2 * k), joint='curve')
    layer = layer.resize((W, H), Image.LANCZOS)
    return Image.alpha_composite(ground, layer)


def build_grounds(day, mask):
    a = arr(day)
    alpha = (1.0 - mask) * 255.0
    lights = city_lights(day, mask)
    tx, ty = tower_top(day)
    grounds = {}
    for phase in PHASES:
        g = grade(a, phase)
        if phase in ('night', 'moon'):
            lit = np.clip(lights * 1.6, 0, 1)
            g = g * (1 - lit) + np.array([255, 200, 130]) * lit
            # Two red aircraft lights on the tower top.
            yy, xx = np.mgrid[0:H, 0:W]
            for dx in (-6, 6):
                d2 = (xx - (tx + dx)) ** 2 + (yy - ty) ** 2
                dot = np.exp(-d2 / 6.0)[..., None]
                g = g * (1 - dot) + np.array([255, 40, 40]) * dot
        rgba = np.concatenate([np.clip(g, 0, 255), alpha[..., None]], axis=2)
        grounds[phase] = draw_cables(img(rgba, 'RGBA'), phase)
    return grounds


# ------------------------------------------------------------------- video

def compose(ground, sky, drift):
    """A full frame: the sky (drifted) behind the relit foreground."""
    # Back and forth rather than round and round: a mirrored sky has no seam.
    span = SKY_W - W
    x = int(drift) % (2 * span)
    x = x if x <= span else 2 * span - x
    canvas = Image.new('RGB', (W, H), (0, 0, 0))
    canvas.paste(img(sky).crop((x, 0, x + W, SKY_H)), (0, 0))
    canvas.paste(ground, (0, 0), ground)
    return canvas


def stars_layer(t, seed=3, count=140):
    """Twinkling points for the night frames of the video."""
    rng = np.random.default_rng(seed)
    xs = rng.integers(0, W, count)
    ys = rng.integers(0, HORIZON - 60, count)
    phase = rng.random(count) * 6.28
    speed = 1.5 + rng.random(count) * 2.5
    layer = np.zeros((H, W), np.float32)
    brightness = 0.35 + 0.65 * (0.5 + 0.5 * np.sin(phase + speed * t))
    layer[ys, xs] = brightness * 255
    return img(layer, 'L').filter(ImageFilter.GaussianBlur(0.7))


def video(grounds, skies, path, fps=30, seconds=24):
    """Day, sunset, night, moonlit night, dawn and back to day: a loop."""
    ffmpeg = find_ffmpeg()
    order = ['day', 'sunset', 'night', 'moon', 'dawn', 'day']
    hold, fade = 0.55, 0.45                  # of each step: holding, then blending
    steps = len(order) - 1
    frames = fps * seconds
    proc = subprocess.Popen(
        [ffmpeg, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
         '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
         '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow',
         '-movflags', '+faststart', path],
        stdin=subprocess.PIPE)
    full = {p: None for p in PHASES}
    for f in range(frames):
        pos = f / frames * steps
        i = min(int(pos), steps - 1)
        local = pos - i
        t = 0.0 if local < hold else (local - hold) / fade
        t = t * t * (3 - 2 * t)              # ease in and out
        drift = f * 0.6                      # clouds and stars move on their own
        a = compose(grounds[order[i]], skies[order[i]], drift)
        b = compose(grounds[order[i + 1]], skies[order[i + 1]], drift)
        frame = Image.blend(a, b, t)
        night = {'night': 1, 'moon': 1}
        n = night.get(order[i], 0) * (1 - t) + night.get(order[i + 1], 0) * t
        if n > 0:
            st = stars_layer(f / fps)
            sky_only = img((1 - arr(grounds['day'])[..., 3:4] / 255.0) * arr(st.convert('RGB')) * n)
            frame = Image.fromarray(np.clip(arr(frame) + arr(sky_only), 0, 255).astype(np.uint8))
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    proc.wait()


def find_ffmpeg():
    for candidate in ('ffmpeg',):
        if subprocess.call(['which', candidate], stdout=subprocess.DEVNULL) == 0:
            return candidate
    import imageio_ffmpeg  # pip install imageio-ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


# -------------------------------------------------------------------- main

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    tri = load(os.path.join(src, 'triptych.jpg'))
    day, _sunset_panel, dawn = panels(tri)
    sunset_w = load(os.path.join(src, 'sunset.jpg'))
    night_w = load(os.path.join(src, 'night.jpg'))
    moon_w = load(os.path.join(src, 'moon.jpg'))

    mask = sky_mask(day)
    skies = build_skies(day, dawn, sunset_w, night_w, moon_w, mask)
    grounds = build_grounds(day, mask)

    os.makedirs(OUT, exist_ok=True)
    for phase in PHASES:
        img(skies[phase]).save(os.path.join(OUT, f'{phase}-sky.jpg'), quality=80, optimize=True, progressive=True)
        grounds[phase].save(os.path.join(OUT, f'{phase}-ground.webp'), quality=82, method=6)
    print('sky and ground layers written to', os.path.normpath(OUT))

    if '--video' in sys.argv:
        path = os.path.join(src, 'timelapse.mp4')
        video(grounds, skies, path)
        print('timelapse written to', path)


if __name__ == '__main__':
    main()
