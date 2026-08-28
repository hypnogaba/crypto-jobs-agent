#!/usr/bin/env python3
"""
Картка для месенджерів і соцмереж (og:image), 1200×630.

Малюється кодом, а не в редакторі, з тих самих величин, що й сайт: кольори з
globals.css, знак — та сама геометрія, що в nav.tsx і brand/logo/logo.svg,
сітка — та сама «міліметрівка». Змінюється знак — перезапустити цей файл.

    python3 brand/og/gen.py

Шрифти лежать поруч (brand/og/fonts) навмисно: у системі їх немає, а картка
має збиратися однаково на будь-якій машині.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "web" / "public" / "og.png"

W, H = 1200, 630
PAPER = (251, 251, 250)
INK = (32, 33, 35)
MUTED = (86, 91, 96)
EMBER = (179, 74, 30)
GRID_FINE = (32, 33, 35, 9)    # ~3.5%
GRID = (32, 33, 35, 18)        # ~7%

img = Image.new("RGB", (W, H), PAPER)
grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
g = ImageDraw.Draw(grid)
for x in range(0, W, 24):
    g.line([(x, 0), (x, H)], fill=GRID_FINE)
for y in range(0, H, 24):
    g.line([(0, y), (W, y)], fill=GRID_FINE)
for x in range(0, W, 120):
    g.line([(x, 0), (x, H)], fill=GRID)
for y in range(0, H, 120):
    g.line([(0, y), (W, y)], fill=GRID)
img = Image.alpha_composite(img.convert("RGBA"), grid).convert("RGB")
d = ImageDraw.Draw(img)


def mark(x, y, size):
    """Знак: три пройдені сходинки й четверта клітинка попереду.

    Геометрія в системі 512×512, як у logo.svg. Ламана намальована
    прямокутниками, а не лінією: усі відрізки осьові, а прямокутник дає
    рівно той самий квадратний торець і заповнений кут, що й SVG."""
    k = size / 512

    def p(*v):
        return tuple(x + v[0] * k if i % 2 == 0 else y + v[i] * k for i, v in enumerate([v[0], v[1], v[2], v[3]]))

    def rect(x1, y1, x2, y2, fill):
        d.rectangle([x + x1 * k, y + y1 * k, x + x2 * k, y + y2 * k], fill=fill)

    d.rounded_rectangle([x, y, x + size, y + size], radius=96 * k, fill=EMBER)
    s = 24  # половина товщини штриха
    for x1, y1, x2, y2 in [
        (118, 386, 118, 302), (118, 302, 202, 302), (202, 302, 202, 218),
        (202, 218, 286, 218), (286, 218, 286, 134),
    ]:
        rect(min(x1, x2) - s, min(y1, y2) - s, max(x1, x2) + s, max(y1, y2) + s, PAPER)
    rect(328, 92, 412, 176, PAPER)


f_word = ImageFont.truetype(str(HERE / "fonts/InterTight-600.ttf"), 44)
f_head = ImageFont.truetype(str(HERE / "fonts/InterTight-600.ttf"), 88)
f_sub = ImageFont.truetype(str(HERE / "fonts/InterTight-400.ttf"), 34)
f_mono = ImageFont.truetype(str(HERE / "fonts/JetBrainsMono-400.ttf"), 26)

M = 84
mark(M, 78, 76)
d.text((M + 76 + 26, 78 + 38), "NextRole", font=f_word, fill=INK, anchor="lm")

d.text((M, 250), "Five jobs every morning.", font=f_head, fill=INK, anchor="ls")
d.text((M, 320), "Tell us once what you are looking for. Every morning, five",
       font=f_sub, fill=MUTED, anchor="ls")
d.text((M, 366), "matching roles land in your Telegram — each with a live link.",
       font=f_sub, fill=MUTED, anchor="ls")

d.line([(M, 470), (W - M, 470)], fill=(32, 33, 35), width=1)
d.text((M, 512), "nextrole.info", font=f_mono, fill=EMBER, anchor="lm")
d.text((W - M, 512), "free · telegram · 09:00", font=f_mono, fill=MUTED, anchor="rm")

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG", optimize=True)
print(f"{OUT}  {img.size[0]}×{img.size[1]}  {OUT.stat().st_size // 1024} KB")
