#!/bin/bash
# NextRole logo generator — writes SVG variants of the "next step" mark.
# Colours come from the site tokens: ink #202123, paper #fbfbfa, ember #b34a1e / #e58650.
cd "$(dirname "$0")"

grid() { # $1 = line colour alpha stack
cat <<EOF
<defs><pattern id="f" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="$1" stroke-width="1.5"/></pattern><pattern id="m" width="128" height="128" patternUnits="userSpaceOnUse"><path d="M128 0H0V128" fill="none" stroke="$2" stroke-width="2"/></pattern></defs>
EOF
}

# steps <file> <bg> <gridfine> <gridmajor> <stair> <accent>
steps() {
cat > "$1" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
$(grid "$3" "$4")
<rect width="512" height="512" fill="$2"/>
<rect width="512" height="512" fill="url(#f)"/><rect width="512" height="512" fill="url(#m)"/>
<path d="M118 386V302h84v-84h84v-84" fill="none" stroke="$5" stroke-width="48" stroke-linecap="square" stroke-linejoin="miter"/>
<rect x="328" y="92" width="84" height="84" fill="$6"/>
</svg>
EOF
}

# mono <file> <bg> <gridfine> <gridmajor> <stem> <accent>
mono() {
cat > "$1" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
$(grid "$3" "$4")
<rect width="512" height="512" fill="$2"/>
<rect width="512" height="512" fill="url(#f)"/><rect width="512" height="512" fill="url(#m)"/>
<path d="M132 132h48v248h-48zM332 132h48v248h-48z" fill="$5"/>
<path d="M180 132h52l100 160v88h-4L180 220z" fill="$6"/>
</svg>
EOF
}

LG_F="rgb(32 33 35 / 9%)";  LG_M="rgb(32 33 35 / 16%)"
DG_F="rgb(255 255 255 / 10%)"; DG_M="rgb(255 255 255 / 18%)"

steps 01-steps-ember.svg "#b34a1e" "$DG_F" "$DG_M" "#fbfbfa" "#fbfbfa"
steps 02-steps-ink.svg   "#202123" "$DG_F" "$DG_M" "#fbfbfa" "#e58650"
steps 03-steps-paper.svg "#fbfbfa" "$LG_F" "$LG_M" "#202123" "#b34a1e"
mono  04-mono-ink.svg    "#202123" "$DG_F" "$DG_M" "#fbfbfa" "#e58650"
mono  05-mono-paper.svg  "#fbfbfa" "$LG_F" "$LG_M" "#202123" "#b34a1e"
mono  06-mono-ember.svg  "#b34a1e" "$DG_F" "$DG_M" "#fbfbfa" "#fbfbfa"
