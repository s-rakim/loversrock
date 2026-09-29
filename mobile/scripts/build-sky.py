#!/usr/bin/env python3
"""Builds the live-sky backgrounds (components/SkyBackground.js) and their
timelapse loops: the Golden Gate, from pictures, and New York, drawn here.

    pip install pillow numpy imageio-ffmpeg
    python3 scripts/build-sky.py <folder with the four pictures> [--video]

The pictures (kept out of the repo; only what this makes is committed):
    triptych.jpg  three framed portrait panels: day, sunset, pink dawn
    sunset.jpg    wide sunset
    night.jpg     wide starry night
    moon.jpg      wide night with the full moon

Why it is built this way. The pictures were not taken from one spot: the
panels put the couple beside the tower, the wide shots put them far to the
right. Crossfading them would move the couple around the screen. So there is
ONE foreground (the day panel: bridge, hills, water, the bench) with its sky
cut out, relit for each time of day, and each time of day brings only its
SKY from its own picture. Nothing in the scene moves; only the light changes,
and the sky can drift on its own.

The two on the bench are a silhouette: one dark shape, no skin, no hair
colour, so they can be anyone. New York is the same bench and the same two,
on a promenade across the river from a skyline drawn here, under the same
skies.

And why there are so many pictures. Six lights — dawn, day, sunset, the blue
hour after it (made here: there is no picture of it), night and the full
moon — are mixed along SCHEDULE, a whole day of how much of each there is,
changing slowly: an hour or two from one light to the next. The day is
rendered every GRID (twenty minutes) wherever the light is changing, and the
app glides from each picture to the next over those twenty minutes, so the
light never visibly steps. Each picture is its own mix, not a crossfade: the
colour of the sky blends evenly, but the clouds and stars hand over faster in
the middle, so no picture shows two skies' clouds at once.

Makes, in assets/sky/:
    NN-sky.jpg              picture NN's sky, wider than the screen so it can drift
    <scene>/NN.webp         that scene's foreground lit for picture NN, see-through
                            where the sky is (scenes: goldengate, newyork)
    timelapse-<scene>.mp4   with --video: the day rendered frame by frame, looping
and components/skyFrames.js, which lists them and when in the day each one is.
"""
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 624, 1200          # the foreground; about a phone's shape
SKY_W, SKY_H = 1040, 760  # each sky: wider than the screen, for drifting
HORIZON = 690             # the sky never reaches below this row
TOWER_X = (314, 378)      # the tower's columns in the foreground
FULL_MOON = (929, 140)    # the full moon's centre in moon.jpg
NIGHT_MOON = (890, 106)   # the small moon's in night.jpg (the stars are the same)
PHASES = ['dawn', 'day', 'sunset', 'twilight', 'night', 'moon']
SCENES = ['goldengate', 'newyork']

# The day: at each time, how much of each light, and how bright the stars
# are. Between two rows it eases from one to the other; two equal rows in a
# row are a stretch where nothing changes. Local time, on the twenty-minute
# grid, so every row is a picture of its own.
SCHEDULE = [
    ('00:00', {'moon': 1}, 0.8),
    ('03:40', {'moon': 1}, 0.8),
    ('04:40', {'night': 1}, 1.0),
    ('05:20', {'night': 0.55, 'twilight': 0.45}, 0.7),
    ('06:00', {'twilight': 0.5, 'dawn': 0.5}, 0.3),
    ('06:40', {'dawn': 1}, 0.0),
    ('07:20', {'dawn': 0.75, 'day': 0.25}, 0.0),
    ('08:20', {'dawn': 0.3, 'day': 0.7}, 0.0),
    ('09:00', {'day': 1}, 0.0),
    ('16:00', {'day': 1}, 0.0),
    ('16:40', {'day': 0.75, 'sunset': 0.25}, 0.0),
    ('17:20', {'day': 0.4, 'sunset': 0.6}, 0.0),
    ('18:00', {'sunset': 1}, 0.0),
    ('18:40', {'sunset': 1}, 0.05),
    ('19:20', {'sunset': 0.45, 'twilight': 0.55}, 0.15),
    ('20:00', {'twilight': 0.75, 'night': 0.25}, 0.45),
    ('20:40', {'twilight': 0.3, 'night': 0.7}, 0.8),
    ('21:20', {'night': 1}, 1.0),
    ('22:40', {'night': 1}, 1.0),
    ('24:00', {'moon': 1}, 0.8),
]
SCHEDULE = [(int(t[:2]) + int(t[3:]) / 60, w, s) for t, w, s in SCHEDULE]
GRID = 1 / 3              # hours between pictures: twenty minutes

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'sky')
FRAMES_JS = os.path.join(HERE, '..', 'components', 'skyFrames.js')


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


# ------------------------------------------------------------ the couple

# The two of them in the day panel, traced by hand, clockwise from the
# bench's back: his arm and shoulder, his head, a notch, her head leaning on
# his shoulder, her shoulder under his hand, and his arm round her back.
COUPLE_OUTLINE = [
    (258, 978), (258, 940), (260, 905), (265, 885), (274, 868), (290, 857), (310, 849),
    (330, 843), (342, 836), (344, 826), (340, 812), (339, 796), (343, 782), (352, 772),
    (366, 767), (381, 770), (392, 779), (397, 792), (397, 806), (394, 819), (401, 813),
    (410, 807), (424, 806), (438, 810), (449, 818), (457, 830), (463, 843), (470, 855),
    (482, 862), (496, 868), (507, 876), (514, 886), (520, 900), (526, 912), (532, 924),
    (537, 934), (541, 946), (544, 962), (541, 978),
]
# Their legs below the seat, where they are the only dark thing.
COUPLE_LEGS = [[(330, 1098), (390, 1098), (392, 1192), (326, 1192)],
               [(396, 1098), (510, 1098), (510, 1174), (396, 1174)]]
SILHOUETTE = np.array([30, 28, 36], np.float32)


def smooth(points, rounds=3):
    """Chaikin's corner cutting: a traced polygon into a soft outline."""
    pts = np.array(points, np.float32)
    for _ in range(rounds):
        nxt = np.roll(pts, -1, axis=0)
        pts = np.stack([0.75 * pts + 0.25 * nxt, 0.25 * pts + 0.75 * nxt], axis=1).reshape(-1, 2)
    return [tuple(p) for p in pts]


def couple_mask(day):
    """1 where the couple is, antialiased: the traced outline, drawn smooth,
    and the dark of their legs under the seat."""
    k = 4
    layer = Image.new('L', (W * k, H * k), 0)
    ImageDraw.Draw(layer).polygon([(x * k, y * k) for x, y in smooth(COUPLE_OUTLINE)], fill=255)
    upper = arr(layer.resize((W, H), Image.LANCZOS)) / 255.0
    region = Image.new('L', (W, H), 0)
    for leg in COUPLE_LEGS:
        ImageDraw.Draw(region).polygon(leg, fill=255)
    dark = arr(day).mean(axis=2) < 70
    legs = img(((arr(region) > 0) & dark).astype(np.float32) * 255, 'L')
    legs = legs.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    return np.maximum(upper, arr(legs) / 255.0)[..., None]


def silhouette(day, couple):
    """The day panel with the couple as one dark shape, a little lighter at
    the shoulders than below, so it reads as two people and not a hole."""
    a = arr(day)
    shade = np.clip(1.25 - (np.arange(H) - 766) / 420, 0.85, 1.25)[:, None, None]
    return img(a * (1 - couple) + SILHOUETTE * shade * couple)


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


def fit_width(a, width):
    im = img(a)
    h = round(im.height * width / im.width)
    return arr(im.resize((width, h), Image.LANCZOS))


def fit_height(a, height):
    im = img(a)
    w = round(im.width * height / im.height)
    im = im.resize((w, height), Image.LANCZOS)
    if w < SKY_W:
        im = im.resize((SKY_W, height), Image.LANCZOS)
    return arr(im)[:, :SKY_W]


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


# The blue hour after sunset (and before dawn), top to horizon.
TWILIGHT = [(0.0, (14, 20, 54)), (0.5, (40, 40, 92)), (0.8, (118, 70, 96)),
            (0.93, (190, 104, 82)), (1.0, (222, 128, 72))]


def twilight_sky(sunset):
    """The blue hour: the sunset's clouds, under a sky that has gone deep blue
    overhead with the last of the light low down."""
    rows = np.arange(SKY_H) / HORIZON
    stops = np.array([s for s, _ in TWILIGHT])
    colours = np.array([c for _, c in TWILIGHT], np.float32)
    grad = np.stack([np.interp(rows, stops, colours[:, i]) for i in range(3)], axis=1)
    lum = sunset.mean(axis=2)
    row_mean = lum.mean(axis=1, keepdims=True) + 1
    # The clouds only shade the gradient; lit from below, they catch a little more.
    shade = np.clip(0.62 + 0.38 * lum / row_mean, 0.4, 1.5)
    return grad[:, None, :] * shade[..., None]


def move_moon(night, reach=90):
    """The night picture with its small moon moved to where the full moon is.

    The two pictures share their stars and Milky Way exactly; only the moon
    differs, sitting a little up and left of the full one. Moved onto it, the
    night-to-moon blend is the moon swelling in place, with every star still.

    The moon is a round glow, so it is taken out ring by ring — each ring's
    median, less the sky's — which leaves the stars under it where they were,
    and the same glow is added back around its new centre.
    """
    a = arr(night)
    (sx, sy), (dx, dy) = NIGHT_MOON, FULL_MOON
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    here = np.hypot(xx - sx, yy - sy)
    rings = np.array([np.median(a[(here >= k) & (here < k + 1)], axis=0) for k in range(reach + 1)])
    glow = np.clip(rings - rings[-1], 0, None)

    def light(dist):
        return np.stack([np.interp(dist, np.arange(reach + 1), glow[:, c], right=0) for c in range(3)], axis=-1)

    a = np.clip(a - light(here), 0, None) + light(np.hypot(xx - dx, yy - dy))
    return img(a)


def build_skies(day, dawn, sunset_w, night_w, moon_w):
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
    skies['twilight'] = twilight_sky(skies['sunset'])

    # Night and moon: the top of the wide pictures — stars, the Milky Way,
    # the moon — which is all above the tower, scaled to fill the sky, with a
    # soft fall into the city's glow at the horizon.
    for key, src, glow in (('night', move_moon(night_w), (40, 44, 70)), ('moon', moon_w, (52, 60, 88))):
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


def split(sky):
    """A sky as its light (the broad colour) and its detail (clouds, stars)."""
    low = arr(img(sky).filter(ImageFilter.GaussianBlur(22)))
    return low, sky - low


def mix_sky(parts, weights, x0=0, x1=SKY_W):
    """The sky for one mix of lights.

    The light blends by the weights as they are; the detail by their squares,
    so it hands over from one sky's clouds to the next faster, in the middle,
    and a half-and-half moment is one sky's colours with mostly one sky's
    clouds rather than two skies laid over each other.
    """
    norm = sum(w * w for w in weights.values())
    out = np.zeros((SKY_H, x1 - x0, 3), np.float32)
    for phase, w in weights.items():
        low, high = parts[phase]
        out += w * low[:, x0:x1] + (w * w / norm) * high[:, x0:x1]
    return out


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
    if phase == 'twilight':
        # Most of the way to night, a little of the sunset still on it, blue.
        return (0.3 * grade(a, 'sunset') + 0.7 * grade(a, 'night')) * np.array([0.95, 0.98, 1.2]) + np.array([4, 4, 10])
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
    'twilight': (40, 28, 38), 'night': (22, 22, 32), 'moon': (34, 34, 48),
}
# How lit the city, its windows and the aircraft lights are.
LIGHTS_ON = {'sunset': 0.12, 'twilight': 0.55, 'night': 1.0, 'moon': 1.0}


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


def golden_gate(day, mask):
    """The Golden Gate scene: the day panel (the couple already a
    silhouette), see-through where its sky was."""
    tx, ty = tower_top(day)
    return {
        'image': arr(day),
        'alpha': (1.0 - mask) * 255.0,
        'lights': city_lights(day, mask),
        'beacons': [(tx - 6, ty), (tx + 6, ty)],   # the tower top's aircraft lights
        'cables': True,
    }


# ------------------------------------------------------------ new york

NY_SHORE = 700            # the far bank of the river
NY_RAIL = (880, 973)      # the promenade railing's two bars
NY_POSTS = (18, 590)


def new_york(day, couple):
    """New York: the same bench and the same two, on a promenade across the
    river from Manhattan — One World Trade, the Empire State and the
    Chrysler's crown among the blocks — drawn here, at twice the size and
    scaled down so every edge is smooth. Windows light up as it gets dark,
    and the river carries the city and its lights."""
    k = 2
    rng = np.random.default_rng(11)
    colour = Image.new('RGB', (W * k, H * k), (0, 0, 0))
    shape = Image.new('L', (W * k, H * k), 0)
    lit = Image.new('L', (W * k, H * k), 0)
    dc, ds, dl = ImageDraw.Draw(colour), ImageDraw.Draw(shape), ImageDraw.Draw(lit)

    def tint(tone, f):
        return tuple(int(max(0, min(255, c * f))) for c in tone)

    def rect(draw, x0, y0, x1, y1, fill):
        draw.rectangle([x0 * k, y0 * k, x1 * k - 1, y1 * k - 1], fill=fill)

    def poly(draw, pts, fill):
        draw.polygon([(x * k, y * k) for x, y in pts], fill=fill)

    def block(x0, y0, x1, y1, tone, windows=0.0, side=True):
        """One block: its face, a shaded side, and a grid of windows, some of
        which are lit at night."""
        rect(dc, x0, y0, x1, y1, tone)
        rect(ds, x0, y0, x1, y1, 255)
        if side and x1 - x0 > 8:
            rect(dc, x1 - (x1 - x0) * 0.28, y0, x1, y1, tint(tone, 0.8))
        if not windows:
            return
        for wy in np.arange(y0 + 3, y1 - 2, 3.5):
            for wx in np.arange(x0 + 2, x1 - 2, 3.0):
                rect(dc, wx, wy, wx + 1.5, wy + 1.5, tint(tone, 0.78))
                if rng.random() < windows:
                    rect(dl, wx, wy, wx + 1.5, wy + 1.5, int(150 + rng.random() * 105))

    def envelope(x):
        return 1 + 1.2 * np.exp(-((x - 150) / 80) ** 2) + 0.8 * np.exp(-((x - 470) / 100) ** 2)

    # Glass, concrete, limestone, brick, blue glass: muted, as a city is
    # from across a river, and hazier the further off.
    palette = [(128, 138, 156), (150, 147, 140), (164, 153, 134), (130, 110, 98), (112, 128, 150)]
    haze_colour = np.array([192, 202, 218], np.float32)

    def row(widths, heights, haze, dim, windows, base):
        x = -12
        while x < W + 12:
            w = int(rng.integers(*widths))
            h = int(rng.integers(*heights) * envelope(x + w / 2))
            tone = np.array(palette[int(rng.integers(len(palette)))], np.float32) * dim * rng.uniform(0.9, 1.1)
            t = tuple(int(c) for c in tone * (1 - haze) + haze_colour * haze)
            block(x, base - h, x + w, base, t, windows)
            if rng.random() < 0.3:      # a setback on top
                inset = w * 0.2
                block(x + inset, base - h - h * 0.15, x + w - inset, base - h, t, windows)
            if rng.random() < 0.12:     # an antenna
                rect(dc, x + w / 2 - 0.5, base - h - 14, x + w / 2 + 0.5, base - h, tint(t, 0.7))
                rect(ds, x + w / 2 - 0.5, base - h - 14, x + w / 2 + 0.5, base - h, 255)
            x += w + int(rng.integers(-3, 2))

    # Far off, hazy; then the middle distance.
    row((8, 20), (30, 80), 0.6, 1.0, 0.0, NY_SHORE)
    row((12, 30), (40, 130), 0.15, 1.0, 0.4, NY_SHORE + 1)

    # One World Trade Center: tapering facets, a parapet, the spire.
    glass = (134, 156, 182)
    base, top = NY_SHORE, 380
    poly(dc, [(132, base), (150, base), (150, top), (141, top)], tint(glass, 1.1))
    poly(dc, [(150, base), (168, base), (159, top), (150, top)], tint(glass, 0.85))
    poly(ds, [(132, base), (168, base), (159, top), (141, top)], 255)
    for y in range(top + 6, base, 7):   # the odd lit floor
        if rng.random() < 0.5:
            f = (y - top) / (base - top)
            rect(dl, 142 - 9 * f, y, 158 + 9 * f, y + 1, int(120 + rng.random() * 100))
    block(143, top - 8, 157, top, tint(glass, 0.9), 0.0, side=False)
    block(149.2, top - 78, 150.8, top - 8, (170, 176, 186), 0.0, side=False)

    # The Empire State: stone, in tiers, the mast and the antenna; its top
    # floodlit at night.
    stone = (160, 150, 136)
    for i, (x0, y0, x1, y1) in enumerate([(433, 565, 477, NY_SHORE), (438, 505, 472, 565),
                                          (444, 478, 466, 505), (449, 462, 461, 478),
                                          (452, 450, 458, 462)]):
        block(x0, y0, x1, y1, stone, 0.45 if i < 2 else 0.0)
        if i >= 2:
            rect(dl, x0, y0, x1, y1, 190)
    block(454, 418, 456, 450, tint(stone, 0.9), 0.0, side=False)
    block(454.6, 392, 455.4, 418, (120, 120, 126), 0.0, side=False)

    # The Chrysler: a slim tower, the crown of stacked arches, the needle.
    body, crown = (146, 148, 156), (212, 216, 226)
    block(519, 520, 541, NY_SHORE, body, 0.4)
    y = 520
    for w, h in [(20, 14), (15, 12), (10, 10), (6, 8)]:
        x0, x1 = 530 - w / 2, 530 + w / 2
        for draw, fill in ((dc, crown), (ds, 255), (dl, 210)):
            draw.rectangle([x0 * k, (y - h / 2) * k, x1 * k, y * k], fill=fill)
            draw.pieslice([x0 * k, (y - h) * k, x1 * k, y * k], 180, 360, fill=fill)
        y -= h * 0.8
    poly(dc, [(528.8, y), (531.2, y), (530, y - 34)], crown)
    poly(ds, [(528.8, y), (531.2, y), (530, y - 34)], 255)

    # Nearer, lower blocks along the far bank.
    row((18, 46), (16, 64), 0.0, 0.8, 0.3, NY_SHORE + 2)

    b = arr(shape.resize((W, H), Image.LANCZOS)) / 255.0
    city = arr(colour.resize((W, H), Image.LANCZOS))
    windows = arr(lit.resize((W, H), Image.LANCZOS)) / 255.0
    city[b > 0] /= b[b > 0][:, None]        # un-premultiply the antialiased edges

    # The river: paler far off, deeper up close, with long low ripples.
    ys = np.arange(H, dtype=np.float32)
    t = np.clip((ys - NY_SHORE) / (NY_RAIL[1] - NY_SHORE), 0, 1)[:, None, None] ** 0.7
    river = np.array([122, 148, 174], np.float32) * (1 - t) + np.array([38, 72, 104], np.float32) * t
    river = np.broadcast_to(river, (H, W, 3)).copy()
    ripple = arr(img(rng.random((H // 2, W // 10)) * 255, 'L').resize((W, H), Image.BICUBIC)) / 255.0 - 0.5
    river += (ripple * (10 + 14 * t[..., 0]))[..., None]
    # The city upside down in it, broken up by the ripples, fading with distance.
    reflect = np.zeros((H, W), np.float32)
    for y in range(NY_SHORE, min(H, NY_SHORE + 260)):
        d = y - NY_SHORE
        src = NY_SHORE - 1 - d
        if src < 0:
            break
        shift = int(round(2.5 * np.sin(y * 0.7) + 3 * ripple[y, 0]))
        fade = (1 - d / 260) ** 2
        a = np.roll(b[src], shift)[:, None] * 0.38 * fade
        river[y] = river[y] * (1 - a) + np.roll(city[src], shift, axis=0) * 0.8 * a
        reflect[y] = np.roll(windows[src], shift) * 0.6 * fade
    # Lights on water stretch into streaks towards you.
    streak = sum(np.roll(reflect, dy, axis=0) for dy in range(0, 9, 2)) / 3
    streak = arr(img(streak * 255, 'L').filter(ImageFilter.GaussianBlur(0.8))) / 255.0
    rows = (ys >= NY_SHORE)[:, None]
    image = np.where(rows[..., None], river, city)
    alpha = np.where(rows, 1.0, b)
    image[NY_SHORE:NY_SHORE + 4] = (70, 72, 80)          # the far bank's edge
    lights = np.where(rows, np.clip(streak, 0, 1), windows)

    # The promenade railing: two bars on two posts.
    steel = np.array([150, 152, 158], np.float32)
    for y0 in NY_RAIL:
        image[y0 - 3:y0 + 3] = steel
        image[y0 - 3] = steel * 1.3
        image[y0 + 2] = steel * 0.6
        lights[y0 - 3:y0 + 3] = 0
    for x0 in NY_POSTS:
        image[NY_RAIL[0] - 3:990, x0:x0 + 6] = steel * np.array([1.2, 1.2, 1.2, 1.0, 0.8, 0.7])[:, None]
        lights[NY_RAIL[0] - 3:990, x0:x0 + 6] = 0

    # The bench, the ground and the two of them, from the Golden Gate panel.
    yy, xx = np.mgrid[0:H, 0:W]
    keep = (yy >= 985) | ((xx >= 192) & (yy >= 978 - (xx - 192) * 15 / 432))
    keep = arr(img(keep.astype(np.float32) * 255, 'L').filter(ImageFilter.GaussianBlur(0.7)))[..., None] / 255.0
    keep = np.maximum(keep, couple)
    image = image * (1 - keep) + arr(day) * keep
    lights = lights[..., None] * (1 - keep)
    alpha = np.maximum(alpha, keep[..., 0])
    return {
        'image': image,
        'alpha': alpha * 255.0,
        'lights': lights,
        'beacons': [(150, 302), (455, 392)],    # the spires' aircraft lights
        'cables': False,
    }


def build_grounds(scene):
    """A scene's foreground under each light, as RGBA arrays (all the same
    shape and the same see-through sky, so any mix of them is a weighted sum)."""
    yy, xx = np.mgrid[0:H, 0:W]
    grounds = {}
    for phase in PHASES:
        g = grade(scene['image'], phase)
        on = LIGHTS_ON.get(phase, 0)
        if on:
            glow = np.clip(scene['lights'] * 1.6, 0, 1) * on
            g = g * (1 - glow) + np.array([255, 200, 130]) * glow
            for bx, by in scene['beacons']:
                dot = np.exp(-((xx - bx) ** 2 + (yy - by) ** 2) / 6.0)[..., None] * on
                g = g * (1 - dot) + np.array([255, 40, 40]) * dot
        ground = img(np.concatenate([np.clip(g, 0, 255), scene['alpha'][..., None]], axis=2), 'RGBA')
        if scene['cables']:
            ground = draw_cables(ground, phase)
        grounds[phase] = arr(ground)
    return grounds


def mix_ground(grounds, weights):
    return sum(w * grounds[phase] for phase, w in weights.items())


# ---------------------------------------------------------------- the day

def state(hour):
    """How much of each light at `hour`, and how bright the stars are."""
    for (h0, w0, s0), (h1, w1, s1) in zip(SCHEDULE, SCHEDULE[1:]):
        if h0 <= hour <= h1:
            x = (hour - h0) / (h1 - h0)
            x = x * x * (3 - 2 * x)          # ease in and out
            w = {p: w0.get(p, 0) * (1 - x) + w1.get(p, 0) * x for p in PHASES}
            return {p: v for p, v in w.items() if v > 1e-4}, s0 + (s1 - s0) * x
    raise ValueError(hour)


def plan():
    """The pictures, and the day as (hour, picture, stars): one row every
    GRID hours, the same picture reused wherever the light holds still."""
    pictures, timeline, seen = [], [], {}
    for k in range(round(24 / GRID) + 1):
        hour = k * GRID
        weights, stars = state(hour)
        key = tuple(round(weights.get(p, 0), 3) for p in PHASES)
        if key not in seen:
            seen[key] = len(pictures)
            pictures.append(weights)
        timeline.append((hour, seen[key], round(stars, 3)))
    # A row in the middle of a stretch that holds still says nothing new.
    kept = [row for i, row in enumerate(timeline)
            if i in (0, len(timeline) - 1)
            or not (timeline[i - 1][1:] == row[1:] == timeline[i + 1][1:])]
    return pictures, kept


def write_js(pictures, timeline):
    def mix(w):
        return ', '.join(f'{p}: {round(w[p], 3):g}' for p in PHASES if p in w)
    lines = [
        '// Made by scripts/build-sky.py: do not edit by hand, run it again.',
        '//',
        '// SKY_FRAMES are the pictures of the day, each its own mix of lights:',
        '// the sky, and each scene\'s foreground under it.',
        '// SKY_TIMELINE is [hour, picture, stars] through the day: between two',
        '// rows the sky blends from one picture to the next.',
        '/* eslint-disable global-require */',
        'export const SKY_FRAMES = [',
    ]
    for i, w in enumerate(pictures):
        grounds = ', '.join(f"{scene}: require('../assets/sky/{scene}/{i:02d}.webp')" for scene in SCENES)
        lines.append(f"  {{\n    sky: require('../assets/sky/{i:02d}-sky.jpg'),\n"
                     f"    ground: {{ {grounds} }},\n    mix: {{ {mix(w)} }},\n  }},")
    lines.append('];')
    lines.append('')
    lines.append('export const SKY_TIMELINE = [')
    for hour, picture, stars in timeline:
        lines.append(f'  [{round(hour, 4):g}, {picture}, {stars:g}],')
    lines.append('];')
    with open(FRAMES_JS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


# ------------------------------------------------------------------- video

def stars_layer(t, period, seed=3, count=140):
    """Twinkling points for the dark part of the video. Every star twinkles
    a whole number of times per loop, so the loop has no seam."""
    rng = np.random.default_rng(seed)
    xs = rng.integers(0, W, count)
    ys = rng.integers(0, HORIZON - 60, count)
    phase = rng.random(count) * 2 * np.pi
    cycles = rng.integers(10, 26, count)
    layer = np.zeros((H, W), np.float32)
    brightness = 0.35 + 0.65 * (0.5 + 0.5 * np.sin(phase + 2 * np.pi * cycles * t / period))
    layer[ys, xs] = brightness * 255
    return arr(img(layer, 'L').filter(ImageFilter.GaussianBlur(0.7)))[..., None]


def video_clock(seconds_per_hour=5.0, hold=2.0):
    """(second of the video, hour of the day): the light changing at an
    unhurried, steady pace (five seconds for each hour of it), and the long
    stretches where it holds still kept short."""
    points = [(0.0, SCHEDULE[0][0])]
    for (h0, w0, _), (h1, w1, _) in zip(SCHEDULE, SCHEDULE[1:]):
        points.append((points[-1][0] + (hold if w0 == w1 else (h1 - h0) * seconds_per_hour), h1))
    return np.array([p[0] for p in points]), np.array([p[1] for p in points])


def video(grounds, parts, path, fps=24, start_hour=12.0):
    """The whole day, rendered frame by frame from SCHEDULE, looping."""
    ffmpeg = find_ffmpeg()
    secs, hours = video_clock()
    length = secs[-1]
    frames = round(length * fps)
    offset = float(np.interp(start_hour, hours, secs))
    span = SKY_W - W
    proc = subprocess.Popen(
        [ffmpeg, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
         '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
         '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow',
         '-movflags', '+faststart', path],
        stdin=subprocess.PIPE)
    see_through = 1 - grounds['day'][..., 3:4] / 255.0
    for f in range(frames):
        t = f / fps
        hour = float(np.interp((offset + t) % length, secs, hours))
        weights, stars = state(hour)
        # One slow sweep of the sky there and back per loop.
        x = int(round(span * (0.5 - 0.5 * np.cos(2 * np.pi * f / frames))))
        canvas = np.zeros((H, W, 3), np.float32)
        canvas[:SKY_H] = mix_sky(parts, weights, x, x + W)
        if stars > 0:
            canvas += stars_layer(t, length) * stars * see_through
        ground = mix_ground(grounds, weights)
        a = ground[..., 3:4] / 255.0
        frame = canvas * (1 - a) + ground[..., :3] * a
        proc.stdin.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes())
    proc.stdin.close()
    proc.wait()


def find_ffmpeg():
    if shutil.which('ffmpeg'):
        return 'ffmpeg'
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
    skies = build_skies(day, dawn, sunset_w, night_w, moon_w)
    parts = {p: split(skies[p]) for p in PHASES}
    couple = couple_mask(day)
    day = silhouette(day, couple)
    scenes = {'goldengate': golden_gate(day, mask), 'newyork': new_york(day, couple)}
    grounds = {name: build_grounds(scene) for name, scene in scenes.items()}

    # Everything from an earlier build, which may have had more pictures.
    for folder in [OUT] + [os.path.join(OUT, name) for name in SCENES]:
        os.makedirs(folder, exist_ok=True)
        for name in os.listdir(folder):
            if name.endswith(('.jpg', '.webp')) or (folder == OUT and name == 'timelapse.mp4'):
                os.remove(os.path.join(folder, name))
    pictures, timeline = plan()
    for i, weights in enumerate(pictures):
        img(mix_sky(parts, weights)).save(os.path.join(OUT, f'{i:02d}-sky.jpg'), quality=76, optimize=True, progressive=True)
        for name in SCENES:
            img(mix_ground(grounds[name], weights), 'RGBA').save(os.path.join(OUT, name, f'{i:02d}.webp'), quality=80, method=6)
    write_js(pictures, timeline)
    print(f'{len(pictures)} pictures written to', os.path.normpath(OUT))

    if '--video' in sys.argv:
        for name in SCENES:
            path = os.path.join(OUT, f'timelapse-{name}.mp4')
            video(grounds[name], parts, path)
            shutil.copy(path, os.path.join(src, f'timelapse-{name}.mp4'))
            print('timelapse written to', os.path.normpath(path))


if __name__ == '__main__':
    main()
