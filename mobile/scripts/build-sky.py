#!/usr/bin/env python3
"""Builds the live-sky backgrounds (components/SkyBackground.js) and their
timelapse loops, for two scenes: the Golden Gate and New York.

    pip install pillow numpy imageio-ffmpeg
    python3 scripts/build-sky.py <folder with the pictures> [--video]

The pictures (kept out of the repo; only what this makes is committed):
    triptych.jpg  Golden Gate: three framed portrait panels: day, sunset, pink dawn
    sunset.jpg    Golden Gate: wide sunset
    night.jpg     wide starry night
    moon.jpg      wide night with the full moon
    newyork.jpg   New York: three framed portrait panels: day, sunset, dawn

Why it is built this way. The pictures of a scene were not taken from one
spot, so crossfading them would move the couple around the screen. So each
scene has ONE foreground (its day panel: the view, the river, the bench) with
its sky cut out, relit for each light of the day, and each light brings only
its SKY, from its own picture. Nothing in the scene moves; only the light
changes, and the sky can drift on its own. New York's sunset and dawn panels
give it its own sunset and dawn colours; the stars and the moon are shared.

The two on the bench are a silhouette: one dark shape, no skin, no hair
colour, so they can be anyone.

And why there are so many pictures. Seven lights — dawn, day, the golden
afternoon, sunset, the blue hour after it (made here: there is no picture of
it), night and the full moon — are mixed along SCHEDULE, a whole day of how
much of each there is, never quite standing still: an hour or two from one
light to the next, the morning brightening to noon and warming through the
afternoon, the moon rising and setting. The day is rendered every GRID
(twenty minutes), a picture for each, and the app glides from each picture
to the next over those twenty minutes, so the light never visibly steps. Each
picture is its own mix, not a crossfade: the colour of the sky blends evenly,
but the clouds and stars hand over faster in the middle, so no picture shows
two skies' clouds at once.

Makes, in assets/sky/<scene>/ (goldengate, newyork):
    NN-sky.jpg              picture NN's sky, wider than the screen so it can drift
    NN-ground.webp          the foreground lit for picture NN, see-through where the sky is
and in assets/sky/, with --video, timelapse-<scene>.mp4: the day rendered
frame by frame, looping. And components/skyFrames.js, which lists them and
when in the day each one is.
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
PHASES = ['dawn', 'day', 'golden', 'sunset', 'twilight', 'night', 'moon']
SCENES = ['goldengate', 'newyork']

# The day: at each time, how much of each light, and how bright the stars
# are. Between two rows it eases from one to the other. No two rows in a row
# are the same, so the light never stands still. Local time, on the
# twenty-minute grid.
SCHEDULE = [
    ('00:00', {'moon': 0.85, 'night': 0.15}, 0.8),
    ('01:20', {'moon': 1}, 0.75),
    ('02:40', {'moon': 0.75, 'night': 0.25}, 0.8),      # the moon going down
    ('03:40', {'moon': 0.4, 'night': 0.6}, 0.9),
    ('04:40', {'night': 1}, 1.0),
    ('05:20', {'night': 0.55, 'twilight': 0.45}, 0.7),
    ('06:00', {'twilight': 0.5, 'dawn': 0.5}, 0.3),
    ('06:40', {'dawn': 1}, 0.0),
    ('07:20', {'dawn': 0.75, 'day': 0.25}, 0.0),
    ('08:20', {'dawn': 0.35, 'day': 0.65}, 0.0),
    ('09:40', {'dawn': 0.1, 'day': 0.9}, 0.0),
    ('12:00', {'day': 1}, 0.0),                        # noon
    ('13:20', {'day': 0.92, 'golden': 0.08}, 0.0),
    ('14:40', {'day': 0.75, 'golden': 0.25}, 0.0),
    ('16:00', {'day': 0.4, 'golden': 0.6}, 0.0),
    ('17:00', {'golden': 0.75, 'sunset': 0.25}, 0.0),
    ('17:40', {'golden': 0.35, 'sunset': 0.65}, 0.0),
    ('18:20', {'sunset': 1}, 0.0),
    ('18:40', {'sunset': 0.9, 'twilight': 0.1}, 0.05),
    ('19:20', {'sunset': 0.45, 'twilight': 0.55}, 0.15),
    ('20:00', {'twilight': 0.75, 'night': 0.25}, 0.45),
    ('20:40', {'twilight': 0.3, 'night': 0.7}, 0.8),
    ('21:20', {'night': 1}, 1.0),
    ('22:20', {'night': 0.85, 'moon': 0.15}, 0.95),    # the moon coming up
    ('23:20', {'night': 0.45, 'moon': 0.55}, 0.85),
    ('24:00', {'moon': 0.85, 'night': 0.15}, 0.8),
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

# The two of them in each day panel, traced by hand, clockwise from the
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
NY_OUTLINE = [
    (258, 975), (260, 945), (264, 920), (270, 900), (280, 878), (298, 862), (315, 850),
    (330, 842), (342, 835), (342, 824), (337, 812), (336, 798), (340, 782), (350, 770),
    (365, 765), (381, 768), (393, 777), (399, 790), (399, 805), (396, 818), (402, 811),
    (413, 805), (426, 807), (440, 815), (453, 828), (465, 845), (477, 859), (490, 867),
    (503, 876), (515, 889), (521, 905), (524, 922), (532, 934), (541, 946), (543, 960),
    (541, 975),
]
NY_LEGS = [[(330, 1098), (510, 1098), (510, 1198), (330, 1198)]]
NY_SHORE = 742            # where the river meets the far bank, in New York
SILHOUETTE = np.array([30, 28, 36], np.float32)


def smooth(points, rounds=3):
    """Chaikin's corner cutting: a traced polygon into a soft outline."""
    pts = np.array(points, np.float32)
    for _ in range(rounds):
        nxt = np.roll(pts, -1, axis=0)
        pts = np.stack([0.75 * pts + 0.25 * nxt, 0.25 * pts + 0.75 * nxt], axis=1).reshape(-1, 2)
    return [tuple(p) for p in pts]


def couple_mask(day, outline=COUPLE_OUTLINE, legs_at=COUPLE_LEGS):
    """1 where the couple is, antialiased: the traced outline, drawn smooth,
    and the dark of their legs under the seat."""
    k = 4
    layer = Image.new('L', (W * k, H * k), 0)
    ImageDraw.Draw(layer).polygon([(x * k, y * k) for x, y in smooth(outline)], fill=255)
    upper = arr(layer.resize((W, H), Image.LANCZOS)) / 255.0
    region = Image.new('L', (W, H), 0)
    for leg in legs_at:
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


def golden_sky(day):
    """The golden afternoon: the day's sky, deepening overhead and warming
    towards the horizon."""
    g = (np.clip(np.arange(SKY_H) / HORIZON, 0, 1) ** 1.6)[:, None, None]
    warm = day * np.array([1.08, 0.9, 0.7]) + np.array([34, 16, 0])
    return (day * 0.94) * (1 - g) + warm * g


def city_tops(a, start=150, limit=H, threshold=12, confirm=3):
    """For each column of a city picture, the first row that is not sky.

    Walking down each column, the sky's colour is carried along (with the
    way every still-sky column is drifting, row by row), and the first place
    the picture leaves it for good is the top of a building. Glass towers
    that mirror the sky still have an edge. Below that, it is all city.
    """
    est = a[start].copy()
    top = np.full(a.shape[1], limit, int)
    sky = np.ones(a.shape[1], bool)
    for y in range(start + 1, min(limit, a.shape[0] - confirm)):
        drift = np.median((a[y] - a[y - 1])[sky], axis=0)
        est = est + drift
        off = np.minimum.reduce([np.abs(a[y + k] - est - drift * k).max(-1) for k in range(confirm)])
        hit = sky & (off > threshold)
        top[hit] = y
        sky &= ~hit
        est[sky] = 0.6 * est[sky] + 0.4 * a[y][sky]
        if not sky.any():
            break
    # One stray column is noise, not a building.
    padded = np.pad(top, 1, mode='edge')
    return np.median(np.stack([padded[:-2], padded[1:-1], padded[2:]]), axis=0).astype(int)


def panel_sky(panel, detail=1.0):
    """A sky from a city panel: its colour row by row, measured only where it
    is sky and carried on below the skyline, with the grain of the open sky
    above the buildings laid over it, mirrored wide enough to drift."""
    a = arr(panel)
    top = city_tops(a)
    profile = np.full((SKY_H, 3), np.nan, np.float32)
    for y in range(SKY_H):
        open_sky = top > y + 3
        if open_sky.sum() > 40:
            profile[y] = np.median(a[y, open_sky], axis=0)
    good = np.where(~np.isnan(profile[:, 0]))[0]
    last = good[-1]
    slope = (profile[last] - profile[max(0, last - 30)]) / max(1, last - max(0, last - 30))
    for y in range(last + 1, SKY_H):
        profile[y] = np.clip(profile[last] + slope * (y - last) * 0.5, 0, 255)
    clear = max(40, int(top.min()) - 6)       # above the tallest spire: open sky only
    block = a[:clear] - a[:clear].mean(axis=1, keepdims=True)
    block = mirror_tile(block, SKY_W)
    grain = np.concatenate([block, block[::-1]] * (SKY_H // (2 * clear) + 1), axis=0)[:SKY_H]
    return profile[:, None, :] + grain * detail


def new_york_skies(day, sunset, dawn, shared):
    """New York's own skies from its panels; the stars and the moon shared."""
    skies = {
        'day': panel_sky(day),
        'sunset': panel_sky(sunset, 0.6),
        'dawn': panel_sky(dawn),
        'night': shared['night'],
        'moon': shared['moon'],
    }
    skies['golden'] = golden_sky(skies['day'])
    skies['twilight'] = twilight_sky(skies['sunset'])
    return skies


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
    skies['golden'] = golden_sky(skies['day'])

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
    if phase == 'golden':
        # Low, warm afternoon sun.
        return a * np.array([1.04, 0.93, 0.78]) + np.array([14, 6, 0])
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
    'day': (176, 58, 48), 'dawn': (168, 72, 70), 'golden': (184, 70, 44), 'sunset': (74, 32, 28),
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

def new_york(day, top, skies):
    """The New York scene: the day panel (the couple already a silhouette),
    see-through above the skyline. At night its windows light up — a scatter
    on each building, in the rows and columns windows come in — and the
    river carries them, broken up by the ripples. The river also takes the
    colour of the sky above it, orange at sunset, pink at dawn."""
    a = arr(day)
    rng = np.random.default_rng(5)
    yy, xx = np.mgrid[0:H, 0:W]
    city = yy >= top[None, :]
    alpha = arr(img(city.astype(np.float32) * 255, 'L').filter(ImageFilter.GaussianBlur(0.6)))

    grid = (yy % 4 == 0) & (xx % 3 == 1) & (yy > top[None, :] + 5) & (yy < NY_SHORE - 3)
    windows = np.zeros((H, W), np.float32)
    lit = grid & (rng.random((H, W)) < 0.38)
    windows[lit] = 0.5 + 0.5 * rng.random(int(lit.sum()))
    windows = arr(img(windows * 255, 'L').filter(ImageFilter.GaussianBlur(0.5))) / 255.0 * 1.8

    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    water = (yy > NY_SHORE) & (yy < 1070) & (b > r + 6) & (b > 90)
    water = arr(img(water.astype(np.float32) * 255, 'L').filter(ImageFilter.GaussianBlur(1.0)))[..., None] / 255.0

    reflect = np.zeros((H, W), np.float32)
    for y in range(NY_SHORE, min(H, NY_SHORE + 230)):
        d = y - NY_SHORE
        src = NY_SHORE - 1 - d
        if src < 0:
            break
        shift = int(round(2.5 * np.sin(y * 0.7) + 2 * np.sin(y * 0.23)))
        reflect[y] = np.roll(windows[src], shift) * 0.6 * (1 - d / 230) ** 2
    streak = sum(np.roll(reflect, dy, axis=0) for dy in range(0, 9, 2)) / 3
    lights = np.clip(windows + streak * water[..., 0], 0, 1)[..., None]

    # What the river mirrors: the sky just above the skyline, in each light.
    band = slice(max(0, int(np.median(top)) - 80), int(np.median(top)))
    tallest = int(np.argmin(top))
    return {
        'image': a,
        'alpha': alpha,
        'lights': lights,
        'beacons': [(tallest, int(top[tallest]) + 2)],   # the tallest spire's aircraft light
        'cables': False,
        'water': water,
        'mirror': {p: skies[p][band].mean(axis=(0, 1)) for p in PHASES},
    }


def build_grounds(scene):
    """A scene's foreground under each light, as RGBA arrays (all the same
    shape and the same see-through sky, so any mix of them is a weighted sum)."""
    yy, xx = np.mgrid[0:H, 0:W]
    grounds = {}
    for phase in PHASES:
        g = grade(scene['image'], phase)
        if 'water' in scene and phase != 'day':
            # The river takes the colour of the sky, keeping its own ripples.
            lum = scene['image'].mean(axis=2, keepdims=True)
            ripple = lum / max(1.0, float((lum * scene['water']).sum() / scene['water'].sum()))
            sky = scene['mirror'][phase] * (0.55 + 0.45 * ripple) * 0.85
            k = scene['water'] * 0.6
            g = g * (1 - k) + sky * k
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
        '// for each scene, its sky and its foreground under it.',
        '// SKY_TIMELINE is [hour, picture, stars] through the day: between two',
        '// rows the sky blends from one picture to the next.',
        '/* eslint-disable global-require */',
        'export const SKY_FRAMES = [',
    ]
    for i, w in enumerate(pictures):
        lines.append('  {')
        for scene in SCENES:
            lines.append(f"    {scene}: {{ sky: require('../assets/sky/{scene}/{i:02d}-sky.jpg'), "
                         f"ground: require('../assets/sky/{scene}/{i:02d}-ground.webp') }},")
        lines.append(f'    mix: {{ {mix(w)} }},')
        lines.append('  },')
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


def video_clock():
    """(second of the video, hour of the day): an hour and a half a second
    of the day's slow drift, plus five seconds for each full change of light,
    so sunrise and sunset take their time and noon does not drag."""
    points = [(0.0, SCHEDULE[0][0])]
    for (h0, w0, _), (h1, w1, _) in zip(SCHEDULE, SCHEDULE[1:]):
        change = 0.5 * sum(abs(w0.get(p, 0) - w1.get(p, 0)) for p in PHASES)
        points.append((points[-1][0] + (h1 - h0) * 1.5 + change * 5, h1))
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
    gg_day, _sunset_panel, gg_dawn = panels(load(os.path.join(src, 'triptych.jpg')))
    ny_day, ny_sunset, ny_dawn = panels(load(os.path.join(src, 'newyork.jpg')))
    sunset_w = load(os.path.join(src, 'sunset.jpg'))
    night_w = load(os.path.join(src, 'night.jpg'))
    moon_w = load(os.path.join(src, 'moon.jpg'))

    gg_skies = build_skies(gg_day, gg_dawn, sunset_w, night_w, moon_w)
    ny_skies = new_york_skies(ny_day, ny_sunset, ny_dawn, gg_skies)
    parts = {
        'goldengate': {p: split(gg_skies[p]) for p in PHASES},
        'newyork': {p: split(ny_skies[p]) for p in PHASES},
    }
    mask = sky_mask(gg_day)
    ny_top = np.minimum(city_tops(arr(ny_day)), NY_SHORE)
    gg_couple = couple_mask(gg_day)
    ny_couple = couple_mask(ny_day, NY_OUTLINE, NY_LEGS)
    scenes = {
        'goldengate': golden_gate(silhouette(gg_day, gg_couple), mask),
        'newyork': new_york(silhouette(ny_day, ny_couple), ny_top, ny_skies),
    }
    grounds = {name: build_grounds(scene) for name, scene in scenes.items()}

    # Everything from an earlier build, which may have had more pictures.
    for folder in [OUT] + [os.path.join(OUT, name) for name in SCENES]:
        os.makedirs(folder, exist_ok=True)
        for name in os.listdir(folder):
            if name.endswith(('.jpg', '.webp')) or (folder == OUT and name == 'timelapse.mp4'):
                os.remove(os.path.join(folder, name))
    pictures, timeline = plan()
    for i, weights in enumerate(pictures):
        for name in SCENES:
            folder = os.path.join(OUT, name)
            img(mix_sky(parts[name], weights)).save(os.path.join(folder, f'{i:02d}-sky.jpg'), quality=72, optimize=True, progressive=True)
            img(mix_ground(grounds[name], weights), 'RGBA').save(os.path.join(folder, f'{i:02d}-ground.webp'), quality=76, method=6)
    write_js(pictures, timeline)
    print(f'{len(pictures)} pictures a scene written to', os.path.normpath(OUT))

    if '--video' in sys.argv:
        for name in SCENES:
            path = os.path.join(OUT, f'timelapse-{name}.mp4')
            video(grounds[name], parts[name], path)
            shutil.copy(path, os.path.join(src, f'timelapse-{name}.mp4'))
            print('timelapse written to', os.path.normpath(path))


if __name__ == '__main__':
    main()
