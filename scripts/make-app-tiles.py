#!/usr/bin/env python3
"""Shrink the popular-area photos for the /app tile grid.

The originals in public/cities are ~960px wide and 70-210KB each because the
main site shows them large. The app draws them at 183x114 CSS px, so it was
pulling ~1.25MB to fill eight thumbnails — on Lighthouse's throttled mobile
profile that alone is about six seconds, and it was the whole of the 8.5s LCP.

Output is 560px wide (enough for a 3x screen) WebP.
"""
import os
from PIL import Image

SRC = 'public/cities'
OUT = 'public/cities-app'
WIDTH = 560
QUALITY = 78

# The eight tiles on the /app home screen — keep in sync with `areas` in app.astro.
CITIES = ['bangkok', 'singapore', 'kuala_lumpur', 'cebu',
          'hong_kong', 'bali', 'dubai', 'phuket']

os.makedirs(OUT, exist_ok=True)
before = after = 0
for name in CITIES:
    src = f'{SRC}/{name}.jpg'
    im = Image.open(src).convert('RGB')
    h = round(im.height * WIDTH / im.width)
    dst = f'{OUT}/{name}.webp'
    im.resize((WIDTH, h), Image.LANCZOS).save(dst, 'WEBP', quality=QUALITY, method=6)
    b, a = os.path.getsize(src), os.path.getsize(dst)
    before, after = before + b, after + a
    print(f'{name:14s} {b // 1024:4d} KB -> {a // 1024:3d} KB')

print(f'\ntotal {before // 1024} KB -> {after // 1024} KB '
      f'({100 - after * 100 // before}% smaller)')
