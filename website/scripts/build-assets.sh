#!/usr/bin/env bash
# Regenerates the committed images in public/ from docs/brand and the promo stills.
# Not part of `pnpm build`: run it by hand after changing design/*.svg or the stills.
# Needs: magick (ImageMagick 7), rsvg-convert, cwebp, and the Noto Sans TC font installed locally.
set -euo pipefail

site="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$site/.." && pwd)"
stills="$repo/docs/design/promo-intro-zh-tw/assets"
brand="$repo/docs/brand"
pub="$site/public"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Stills: 16:9 crops, 640 px wide (the largest any mockup shows them, at 2x).
for name in rain rooftop lab; do
  magick "$stills/still-$name.jpg" -resize "640x360^" -gravity center -extent 640x360 "$tmp/$name.png"
  cwebp -quiet -q 78 -m 6 "$tmp/$name.png" -o "$pub/images/still-$name-640.webp"
done

# Placeholder poster for the intro video (1920x1080).
magick "$stills/still-rain.jpg" -resize "1920x1080^" -gravity center -extent 1920x1080 "$tmp/poster-bg.png"
rsvg-convert -w 1920 -h 1080 "$site/design/poster-overlay.svg" -o "$tmp/poster-fg.png"
magick "$tmp/poster-bg.png" "$tmp/poster-fg.png" -composite "$tmp/poster.png"
cwebp -quiet -q 80 -m 6 "$tmp/poster.png" -o "$pub/media/intro-poster.webp"

# Open Graph card and raster icons: designed with Codex and kept in docs/brand (see
# docs/brand/README.md), so they are copied, not redrawn here.
cp "$brand/og-1200x630.png" "$pub/og.png"
cp "$brand/favicon-32.png" "$pub/favicon-32.png"
cp "$brand/apple-touch-icon-180.png" "$pub/apple-touch-icon.png"
# The SVG favicon stays the flat vector mark (identical at tab size).
cp "$brand/icon-16.svg" "$pub/favicon.svg"

echo "done: $(ls "$pub/images" | wc -l | tr -d ' ') stills, poster, og.png, favicons"
