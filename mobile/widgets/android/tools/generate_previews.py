#!/usr/bin/env python3
"""Renders the picture the widget picker shows for each loversrock widget.

Why this exists: every widget declared only `android:previewLayout`, which is
an Android 12 feature, and even there a launcher may ignore it — ColorOS does.
With no `android:previewImage` to fall back on, the picker drew the stock
Android robot for all nine, so nobody could tell a kiss button from a
calendar before adding it.

These are illustrations of each widget with believable sample data, in the
widgets' own palette (res/values/widget_colors.xml), rendered to PNG. They
live in drawable-nodpi because a preview is a picture of a fixed thing and
must not be rescaled per density bucket.

Re-run after changing a widget's look:

    python3 widgets/android/tools/generate_previews.py
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, '..', 'res')
OUT = os.path.join(RES, 'drawable-nodpi')
PAIR_ART = os.path.join(HERE, '..', '..', '..', 'assets', 'mascot', 'pair.jpg')

# The widget palette, kept in step with widget_colors.xml by test/widgets.mjs.
SURFACE = (255, 255, 255)
BORDER = (233, 225, 222)
TEXT = (43, 35, 32)
MUTED = (85, 90, 98)
ACCENT = (232, 96, 122)
BLUSH = (243, 184, 196)

# The glass at its default level, as tools/generate_glass.py draws it (the
# picker shows the default; the Settings slider changes it on the phone),
# and the sheen's peak alpha.
GLASS_TOP = (228, 230, 234, round(255 * 0.73))
GLASS_BOTTOM = (174, 178, 186, round(255 * 0.67))
GLASS_SHEEN = 0x73 / 255

CELL = 150        # px per launcher cell in the preview; a preview is scaled to fit anyway
PAD = 28
RADIUS = 34

FONT_DIR = '/usr/share/fonts/truetype/dejavu'
def font(size, bold=False):
    name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)


def card(cells_w, cells_h):
    w, h = cells_w * CELL, cells_h * CELL
    # 2x supersample, so the rounded corners and the heart come out smooth.
    W, H = w * 2, h * 2
    # Grey liquid glass, as drawable/widget_background.xml draws it: a
    # translucent grey body lighter at the top, a sheen over the upper half,
    # and a bright rim.
    body = Image.new('RGBA', (W, H))
    bd = ImageDraw.Draw(body)
    for y in range(H):
        t = y / (H - 1)
        mix = lambda a, b: round(a + (b - a) * t)
        top, bottom = GLASS_TOP, GLASS_BOTTOM
        sheen = max(0.0, 1 - t / 0.45) * GLASS_SHEEN
        rgb = [mix(top[i], bottom[i]) for i in range(3)]
        rgb = [round(c + (255 - c) * sheen) for c in rgb]
        bd.line([(0, y), (W, y)], fill=(*rgb, mix(top[3], bottom[3])))
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([1, 1, W - 2, H - 2], radius=RADIUS * 2, fill=255)
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    img.paste(body, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([1, 1, W - 2, H - 2], radius=RADIUS * 2, outline=(255, 255, 255, 179), width=3)
    return img, d, 2


def finish(img, name):
    w, h = img.size
    img = img.resize((w // 2, h // 2), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'widget_preview_{name}.png')
    img.save(path, optimize=True)
    return path


def heart(d, cx, cy, size, fill):
    """A filled heart from the classic parametric curve."""
    pts = []
    for i in range(120):
        t = 2 * math.pi * i / 120
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * size / 34, cy - y * size / 34))
    d.polygon(pts, fill=fill)


def label(d, s, x, y, text):
    d.text((x * s, y * s), text.upper(), font=font(15 * s, True), fill=MUTED)


def wrap(text, fnt, width, d):
    words, lines, line = text.split(), [], ''
    for word in words:
        trial = f'{line} {word}'.strip()
        if d.textlength(trial, font=fnt) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def glance(name, cells, tag, value, caption, value_size=40):
    img, d, s = card(*cells)
    w = cells[0] * CELL
    label(d, s, PAD, PAD, tag)
    fnt = font(value_size * s, True)
    y = PAD + 34
    for line in wrap(value, fnt, (w - 2 * PAD) * s, d)[:3]:
        d.text((PAD * s, y * s), line, font=fnt, fill=TEXT)
        y += value_size * 1.25
    d.text((PAD * s, (cells[1] * CELL - PAD - 20) * s), caption, font=font(17 * s), fill=MUTED)
    return finish(img, name)


def summary():
    img, d, s = card(4, 2)
    label(d, s, PAD, PAD, 'loversrock')
    rows = [('12', 'day streak'), ('24', 'days to your anniversary'), ('8.2 km', 'apart')]
    y = PAD + 42
    for big, small in rows:
        d.text((PAD * s, y * s), big, font=font(32 * s, True), fill=ACCENT if big == '12' else TEXT)
        bw = d.textlength(big, font=font(32 * s, True)) / s
        d.text(((PAD + bw + 12) * s, (y + 10) * s), small, font=font(18 * s), fill=MUTED)
        y += 64
    return finish(img, 'summary')


def kiss():
    img, d, s = card(2, 2)
    c = CELL
    heart(d, (c + 14) * s, (c - 34) * s, 78 * s, BLUSH)
    heart(d, c * s, (c - 20) * s, 96 * s, ACCENT)
    text = 'Send a kiss'
    f = font(20 * s, True)
    tw = d.textlength(text, font=f) / s
    d.text(((2 * c - tw) / 2 * s, (2 * c - PAD - 26) * s), text, font=f, fill=TEXT)
    return finish(img, 'kiss')


def photo():
    # The locket is NOT glass: the photo is the whole widget, edge to edge.
    s = 2
    size = 2 * CELL
    img = Image.new('RGBA', (size * s, size * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inset = 0
    art = Image.open(PAIR_ART).convert('RGB')
    # Square crop from the top, where the faces are.
    side = min(art.size)
    art = art.crop((0, 0, side, side)).resize(((size - 2 * inset) * s, (size - 2 * inset) * s), Image.LANCZOS)
    mask = Image.new('L', art.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, art.size[0] - 1, art.size[1] - 1],
                                           radius=RADIUS * s, fill=255)
    img.paste(art, (inset * s, inset * s), mask)
    # The caption scrim the real widget draws.
    band = Image.new('RGBA', (art.size[0], 70 * s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    for i in range(70 * s):
        bd.line([(0, i), (art.size[0], i)], fill=(0, 0, 0, int(150 * i / (70 * s))))
    img.alpha_composite(band, (inset * s, (size - inset - 70) * s))
    d.text(((inset + 16) * s, (size - inset - 38) * s), 'From them', font=font(18 * s, True), fill=(255, 255, 255))
    # Keep the scrim inside the rounded corners too.
    from PIL import ImageChops
    img.putalpha(ImageChops.multiply(img.getchannel('A'), mask))
    return finish(img, 'photo')


def canvas():
    img, d, s = card(3, 3)
    w = h = 3 * CELL
    d.rounded_rectangle([14 * s, 14 * s, (w - 14) * s, (h - 70) * s], radius=24 * s, fill=(253, 248, 244))
    # A drawn heart outline and a squiggle, as if by hand.
    pts = []
    for i in range(121):
        t = 2 * math.pi * i / 120
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        wobble = 1 + 0.03 * math.sin(7 * t)
        pts.append(((w / 2 + x * 7.5 * wobble) * s, (h / 2 - 30 - y * 7.5 * wobble) * s))
    d.line(pts, fill=ACCENT, width=9 * s, joint='curve')
    wave = [((60 + i * 6) * s, (h - 120 + 10 * math.sin(i / 3)) * s) for i in range(55)]
    d.line(wave, fill=(111, 143, 214), width=7 * s, joint='curve')
    label(d, s, 22, h - 58, 'Latest drawing')
    d.text((22 * s, (h - 38) * s), 'us at the beach', font=font(17 * s), fill=TEXT)
    return finish(img, 'canvas')


MASCOTS = os.path.join(HERE, '..', 'res', 'drawable-nodpi')
EMOJI_FONT = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'


def emoji(img, text, cx, cy, size):
    """Paste colour emoji centred on (cx, cy). Noto Color Emoji is a bitmap
    font that only renders at 109px, so each is drawn there and scaled."""
    f = ImageFont.truetype(EMOJI_FONT, 109)
    glyphs = Image.new('RGBA', (140 * len(text), 140), (0, 0, 0, 0))
    ImageDraw.Draw(glyphs).text((0, 0), text, font=f, embedded_color=True)
    glyphs = glyphs.crop(glyphs.getbbox())
    scale = size / glyphs.height
    glyphs = glyphs.resize((max(1, int(glyphs.width * scale)), int(size)), Image.LANCZOS)
    img.alpha_composite(glyphs, (int(cx - glyphs.width / 2), int(cy - glyphs.height / 2)))


def wiggle(d, s, x0, x1, cy):
    """The dotted sine from generate_wiggle.py, at preview scale."""
    amp, wave, gap, r = 7, 60, 7, 1.9
    mid = (x0 + x1) / 2
    yv = lambda x: cy + amp * math.sin(2 * math.pi * (x - mid) / wave)
    for direction in (-1, 1):
        x, px, py, run = mid, mid, yv(mid), 0.0
        while x0 <= x <= x1:
            x += direction * 0.1
            run += math.hypot(x - px, yv(x) - py)
            px, py = x, yv(x)
            if run >= gap:
                run -= gap
                if abs(x - mid) > 18:        # the heart covers the middle
                    d.ellipse([(x - r) * s, (py - r) * s, (x + r) * s, (py + r) * s], fill=ACCENT)


def distance():
    img, d, s = card(4, 2)
    w, h = 4 * CELL, 2 * CELL
    d.text((PAD * s, 22 * s), 'Our distance:', font=font(18 * s), fill=MUTED)
    lw = d.textlength('Our distance:', font=font(18 * s)) / s
    d.text(((PAD + lw + 8) * s, 19 * s), '1,305 km', font=font(22 * s, True), fill=TEXT)

    # The two of you, head to toe, in rounded frames.
    top, bottom = 58, h - 46
    col = 78
    boxes = []
    # Her (b) on the left, him (a) on the right — as the layout places them.
    for x0, art in ((PAD, 'b'), (w - PAD - col, 'a')):
        pic = Image.open(os.path.join(MASCOTS, f'widget_mascot_{art}.jpg')).convert('RGBA')
        ph = (bottom - top) * s
        pw = int(pic.width * ph / pic.height)
        pic = pic.resize((pw, ph), Image.LANCZOS)
        mask = Image.new('L', pic.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw - 1, ph - 1], radius=14 * s, fill=255)
        px = int((x0 + col / 2) * s - pw / 2)
        img.paste(pic, (px, top * s), mask)
        boxes.append((px / s, pw / s))

    cy = (top + bottom) / 2 - 10
    wiggle(d, s, boxes[0][0] + boxes[0][1] + 8, boxes[1][0] - 8, cy)
    d.ellipse([(w / 2 - 17) * s, (cy - 17) * s, (w / 2 + 17) * s, (cy + 17) * s],
              fill=(255, 255, 255, 204), outline=(255, 255, 255, 179), width=2 * s)
    heart(d, (w / 2) * s, (cy + 1) * s, 24 * s, ACCENT)
    cap = 'Last known distance'
    cw = d.textlength(cap, font=font(15 * s)) / s
    d.text(((w / 2 - cw / 2) * s, (cy + 30) * s), cap, font=font(15 * s), fill=MUTED)

    # Moods in the picture corners, symptoms underneath.
    for (px, pw), mood, symptoms, corner in ((boxes[0], '🥰', '😖😪', 1), (boxes[1], '😴', '🤕💢', -1)):
        bx = px + pw if corner == 1 else px
        by = bottom - 4
        d.ellipse([(bx - 15) * s, (by - 15) * s, (bx + 15) * s, (by + 15) * s],
                  fill=(255, 255, 255, 204), outline=(255, 255, 255, 179), width=2 * s)
        emoji(img, mood, bx * s, by * s, 19 * s)
        emoji(img, symptoms, (px + pw / 2) * s, (bottom + 24) * s, 17 * s)
    return finish(img, 'distance')


if __name__ == '__main__':
    made = [
        summary(),
        photo(),
        glance('anniversary', (3, 2), 'Together', '963 days', '1,000 in 37 days'),
        glance('question', (4, 2), "Today's question",
               'What was the first thing you noticed about me?', 'Answer in the app', value_size=26),
        glance('nextdate', (3, 2), 'Next date', 'Rooftop dinner', 'in 3 days', value_size=32),
        glance('secret', (4, 2), 'From them', 'A sealed note is waiting', 'Open loversrock to read it',
               value_size=30),
        kiss(),
        canvas(),
        distance(),
    ]
    for path in made:
        print('wrote', os.path.relpath(path, os.path.join(HERE, '..', '..', '..')))
