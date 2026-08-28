#!/bin/bash
# NextRole — генератор знака «наступна сходинка».
#
# Геометрія одна на всі варіанти, різняться лише кольори. Знак навмисно тримає
# відступ від краю: Telegram обрізає аватар у коло, і нічого не має зрізатися.
# Кольори — токени сайту (web/src/app/globals.css).
set -euo pipefail
cd "$(dirname "$0")"

INK="#202123"; PAPER="#fbfbfa"; EMBER="#b34a1e"; EMBER_DARK="#e58650"
GRID_LIGHT_F="rgb(32 33 35 / 9%)";     GRID_LIGHT_M="rgb(32 33 35 / 16%)"
GRID_DARK_F="rgb(255 255 255 / 10%)";  GRID_DARK_M="rgb(255 255 255 / 18%)"

# Три пройдені сходинки, четверта клітинка попереду — ще не зайнята.
STAIR='M118 386V302h84v-84h84v-84'
NEXT_X=328; NEXT_Y=92; NEXT_W=84

# icon <файл> <тло> <сітка-дрібна> <сітка-велика> <сходинки> <клітинка>
icon() {
  cat > "$1" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="NextRole">
  <defs>
    <pattern id="fine" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="$3" stroke-width="1.5"/>
    </pattern>
    <pattern id="major" width="128" height="128" patternUnits="userSpaceOnUse">
      <path d="M128 0H0V128" fill="none" stroke="$4" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="512" height="512" fill="$2"/>
  <rect width="512" height="512" fill="url(#fine)"/>
  <rect width="512" height="512" fill="url(#major)"/>
  <path d="$STAIR" fill="none" stroke="$5" stroke-width="48" stroke-linecap="square"/>
  <rect x="$NEXT_X" y="$NEXT_Y" width="$NEXT_W" height="$NEXT_W" fill="$6"/>
</svg>
EOF
}

icon logo.svg       "$EMBER" "$GRID_DARK_F"  "$GRID_DARK_M"  "$PAPER" "$PAPER"
icon logo-ink.svg   "$INK"   "$GRID_DARK_F"  "$GRID_DARK_M"  "$PAPER" "$EMBER_DARK"
icon logo-paper.svg "$PAPER" "$GRID_LIGHT_F" "$GRID_LIGHT_M" "$INK"   "$EMBER"

# Без тла і без сітки: для вставки в чужу верстку, успадковує колір тексту.
cat > mark.svg <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="NextRole">
  <path d="$STAIR" fill="none" stroke="currentColor" stroke-width="48" stroke-linecap="square"/>
  <rect x="$NEXT_X" y="$NEXT_Y" width="$NEXT_W" height="$NEXT_W" fill="$EMBER"/>
</svg>
EOF

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "не знайдено Chrome — растр не збудовано"; exit 1; }

mkdir -p png
for name in logo logo-ink logo-paper; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --screenshot="png/$name-1024.png" --window-size=512,512 "file://$PWD/$name.svg" 2>/dev/null
done

# Розміри й favicon робить Pillow, а не sips: sips віддає PNG без альфа-каналу,
# а Next.js такий favicon.ico відхиляє («The PNG is not in RGBA format»).
python3 - <<'PYEOF'
from PIL import Image

for name in ("logo", "logo-ink", "logo-paper"):
    src = Image.open(f"png/{name}-1024.png").convert("RGBA")
    src.save(f"png/{name}-1024.png")
    sizes = (512, 256, 180, 128, 64, 48, 32, 16) if name == "logo" else (512,)
    for size in sizes:
        src.resize((size, size), Image.LANCZOS).save(f"png/{name}-{size}.png")

Image.open("png/logo-1024.png").convert("RGBA").save(
    "favicon.ico", sizes=[(48, 48), (32, 32), (16, 16)])
print("favicon.ico зібрано")
PYEOF

echo "готово:"; ls -1 *.svg favicon.ico; ls -1 png
