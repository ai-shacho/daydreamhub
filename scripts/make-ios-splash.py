#!/usr/bin/env python3
"""Generate the iOS launch images for the installed /app PWA.

iOS does not derive a splash screen from the web manifest — without an
apple-touch-startup-image for the exact device size, it shows a blank white
screen until the page paints. One image per device geometry, and it has to
match exactly or iOS ignores it.
"""
import os
from PIL import Image

OUT = 'public/app-splash'
LOGO = 'public/logo-transparent.png'
WHITE = (255, 255, 255)

# (css_width, css_height, scale) — portrait. Matches the media queries emitted
# below; anything not listed just falls back to a blank screen as before.
DEVICES = [
    (440, 956, 3),   # iPhone 16 Pro Max
    (430, 932, 3),   # 16 Plus / 15 Pro Max / 15 Plus / 14 Pro Max
    (402, 874, 3),   # 16 Pro
    (393, 852, 3),   # 16 / 15 / 15 Pro / 14 Pro
    (428, 926, 3),   # 14 Plus / 13 Pro Max / 12 Pro Max
    (390, 844, 3),   # 14 / 13 / 13 Pro / 12 / 12 Pro
    (375, 812, 3),   # 13 mini / 12 mini / X / XS / 11 Pro
    (414, 896, 3),   # 11 Pro Max / XS Max
    (414, 896, 2),   # 11 / XR
    (414, 736, 3),   # 8 Plus
    (375, 667, 2),   # SE / 8 / 7 / 6s
]

os.makedirs(OUT, exist_ok=True)
logo = Image.open(LOGO).convert('RGBA')

links = []
for w, h, scale in DEVICES:
    px_w, px_h = w * scale, h * scale
    canvas = Image.new('RGB', (px_w, px_h), WHITE)
    # Wordmark at 62% of the screen width, optically centred.
    target_w = int(px_w * 0.62)
    target_h = max(1, round(logo.height * target_w / logo.width))
    resized = logo.resize((target_w, target_h), Image.LANCZOS)
    canvas.paste(resized, ((px_w - target_w) // 2, (px_h - target_h) // 2), resized)
    name = f'splash-{px_w}x{px_h}.png'
    canvas.save(f'{OUT}/{name}', optimize=True)
    links.append(
        f'    <link rel="apple-touch-startup-image" href="/app-splash/{name}" '
        f'media="(device-width: {w}px) and (device-height: {h}px) and '
        f'(-webkit-device-pixel-ratio: {scale}) and (orientation: portrait)" />'
    )

print('\n'.join(links))
print(f'\n{len(DEVICES)} images -> {OUT}/', file=__import__('sys').stderr)
