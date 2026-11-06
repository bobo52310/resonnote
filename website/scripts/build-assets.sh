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

# Open Graph card (1200x630): still on the right, text panel on the left.
magick "$stills/still-rain.jpg" -resize "760x630^" -gravity center -extent 760x630 "$tmp/og-still.png"
magick -size 1200x630 xc:'#0b0a09' "$tmp/og-still.png" -gravity east -composite "$tmp/og-bg.png"
rsvg-convert -w 1200 -h 630 "$site/design/og-overlay.svg" -o "$tmp/og-fg.png"
# 256-colour PNG keeps the card under 300 KB; the photo half hides the dithering.
magick "$tmp/og-bg.png" "$tmp/og-fg.png" -gravity northwest -composite -strip \
  -dither FloydSteinberg -colors 256 -define png:compression-level=9 "PNG8:$pub/og.png"

# Favicons.
cp "$brand/icon-16.svg" "$pub/favicon.svg"
rsvg-convert -w 32 -h 32 "$brand/icon-16.svg" -o "$pub/favicon-32.png"
rsvg-convert -w 180 -h 180 "$site/design/apple-touch-icon.svg" -o "$pub/apple-touch-icon.png"

echo "done: $(ls "$pub/images" | wc -l | tr -d ' ') stills, poster, og.png, favicons"
