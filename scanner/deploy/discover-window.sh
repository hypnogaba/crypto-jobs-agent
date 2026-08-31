#!/bin/bash
# Щотижнева розвідка Getro по рухомому вікну.
#
# Драбина щодня зупиняється на R2, тож R3 (колекції Getro) не виконується
# ніколи. Без цього список компаній росте на вісім за добу — з єдиного вузького
# каналу. Тут ми проходимо ~890 живих колекцій шматками, по колу.
set -e
STATE=/var/lib/nextrole/discover-cursor
FROM_MIN=20
TO_MAX=2400
WINDOW=300

mkdir -p "$(dirname "$STATE")"
CUR=$(cat "$STATE" 2>/dev/null || echo "$FROM_MIN")
[ "$CUR" -lt "$FROM_MIN" ] && CUR=$FROM_MIN

TO=$(( CUR + WINDOW - 1 ))
[ "$TO" -gt "$TO_MAX" ] && TO=$TO_MAX

echo "Розвідка Getro: колекції $CUR–$TO"
cd /opt/nextrole-scanner
node dist/discover.js "$CUR" "$TO" 1

NEXT=$(( TO + 1 ))
[ "$NEXT" -gt "$TO_MAX" ] && NEXT=$FROM_MIN && echo "Коло замкнулось — наступного разу з початку"
echo "$NEXT" > "$STATE"
