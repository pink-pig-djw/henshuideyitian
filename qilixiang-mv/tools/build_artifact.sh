#!/usr/bin/env bash
# Package studio.html + its scripts and fonts into build/artifact/ for web publishing.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/artifact
rm -rf "$OUT" && mkdir -p "$OUT/src" "$OUT/vendor" "$OUT/assets/fonts-web"
# the page body between the <!--page--> markers (the host adds doctype/head/body)
sed -n '/<!--page-->/,/<!--\/page-->/p' studio.html | sed '1d;$d' > "$OUT/index.html"
cp src/kit.js src/paint.js src/people.js src/lyrics.js src/scenes.js src/template.js src/main.js src/timing.js src/export.js src/studio.js "$OUT/src/"
cp vendor/mp4-muxer.js "$OUT/vendor/"
cp assets/fonts-web/*.woff2 assets/fonts-web/*.txt "$OUT/assets/fonts-web/"
du -sh "$OUT"; find "$OUT" -type f | sort
