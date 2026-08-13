#!/usr/bin/env python3
"""Draw app icon candidates for the /app PWA.

The shipped icon is the full wordmark, which is unreadable at 60pt on a home
screen. These candidates keep the brand blue but put one large, legible mark in
the middle. Everything stays inside the maskable safe circle (80% of the width)
so the same file works masked or unmasked.
"""
import math
from PIL import Image, ImageDraw, ImageFont

S = 1024                      # draw big, downscale at the end
BLUE = (71, 159, 190)         # sampled from the wordmark's "Hub"
GREY = (88, 88, 90)           # sampled from "DayDream"
WHITE = (255, 255, 255)
SAFE_R = int(S * 0.40)        # maskable safe circle

LATO_BLACK = '/usr/share/fonts/truetype/lato/Lato-Black.ttf'
LATO_BOLD = '/usr/share/fonts/truetype/lato/Lato-Bold.ttf'


def fitted_font(draw, text, path, target_w):
    """Largest size of `path` whose `text` is target_w wide."""
    size = 100
    f = ImageFont.truetype(path, size)
    w = draw.textbbox((0, 0), text, font=f)[2] - draw.textbbox((0, 0), text, font=f)[0]
    return ImageFont.truetype(path, max(10, int(size * target_w / max(w, 1))))


def centered(draw, text, font, cy, fill):
    b = draw.textbbox((0, 0), text, font=font)
    draw.text((S / 2 - (b[2] + b[0]) / 2, cy - (b[3] + b[1]) / 2), text, font=font, fill=fill)


def wave(draw, cy, width, thickness, fill):
    """The wordmark's swoosh, thickened so it survives at icon size.

    Stamped as a dense run of discs rather than a thick polyline — PIL's wide
    lines are unantialiased rectangles and leave visible notches at the joints.
    """
    r = thickness / 2
    steps = int(width * 3)
    for i in range(steps + 1):
        t = i / steps
        x = S / 2 - width / 2 + width * t
        y = cy - math.sin(t * 2 * math.pi) * (width * 0.070)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def candidate_a():
    """Brand blue plate, white DDH. Stands out among pale icons."""
    im = Image.new('RGB', (S, S), BLUE)
    d = ImageDraw.Draw(im)
    f = fitted_font(d, 'DDH', LATO_BLACK, SAFE_R * 1.72)
    centered(d, 'DDH', f, S / 2 + S * 0.02, WHITE)
    wave(d, S / 2 - S * 0.150, SAFE_R * 1.42, int(S * 0.026), WHITE)
    return im


def candidate_b():
    """White plate, blue DDH. Keeps the current light look, but readable."""
    im = Image.new('RGB', (S, S), WHITE)
    d = ImageDraw.Draw(im)
    f = fitted_font(d, 'DDH', LATO_BLACK, SAFE_R * 1.72)
    centered(d, 'DDH', f, S / 2 + S * 0.02, BLUE)
    wave(d, S / 2 - S * 0.150, SAFE_R * 1.42, int(S * 0.026), GREY)
    return im


def candidate_c():
    """Blue plate, the swoosh alone as a symbol, with a small wordmark cue."""
    im = Image.new('RGB', (S, S), BLUE)
    d = ImageDraw.Draw(im)
    wave(d, S / 2 - S * 0.05, SAFE_R * 1.75, int(S * 0.055), WHITE)
    f = fitted_font(d, 'DayDreamHub', LATO_BOLD, SAFE_R * 1.6)
    centered(d, 'DayDreamHub', f, S / 2 + S * 0.16, WHITE)
    return im


CANDIDATES = {'a': candidate_a, 'b': candidate_b, 'c': candidate_c}
CHOSEN = 'a'   # blue plate — the pale icons around it on a home screen all blur together

for key, fn in CANDIDATES.items():
    im = fn()
    im.resize((512, 512), Image.LANCZOS).save(f'/tmp/icon-{key}-512.png')

# Ship the chosen one at the three sizes /app asks for.
final = CANDIDATES[CHOSEN]()
for px in (512, 192, 180):
    final.resize((px, px), Image.LANCZOS).save(f'public/app-icon-{px}.png')
print(f'shipped candidate {CHOSEN.upper()} to public/app-icon-{{512,192,180}}.png')

# Contact sheet: each candidate at real home-screen size next to a 512 preview.
sheet = Image.new('RGB', (760, 300 * len(CANDIDATES)), (232, 232, 234))
sd = ImageDraw.Draw(sheet)
label = ImageFont.truetype(LATO_BOLD, 26)
for i, key in enumerate(CANDIDATES):
    big = Image.open(f'/tmp/icon-{key}-512.png').resize((220, 220), Image.LANCZOS)
    small = Image.open(f'/tmp/icon-{key}-512.png').resize((120, 120), Image.LANCZOS)
    tiny = Image.open(f'/tmp/icon-{key}-512.png').resize((60, 60), Image.LANCZOS)
    y = i * 300 + 40
    sheet.paste(big, (40, y))
    sheet.paste(small, (300, y + 50))
    sheet.paste(tiny, (460, y + 80))
    sd.text((560, y + 90), f'candidate {key.upper()}', font=label, fill=(30, 30, 30))
sheet.save('/tmp/icon-candidates.png')
print('wrote /tmp/icon-candidates.png and /tmp/icon-{a,b,c}-512.png')
