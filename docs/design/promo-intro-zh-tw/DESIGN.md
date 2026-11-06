# ResonNote (共鳴筆記) promo — visual identity

Taken from the extension's own UI (note overlay, film strip, notebook) and the app icon, so the video looks like the product.

## Icon
- Source: `docs/brand/icon.svg` (128-unit viewBox), the vector twin of the Codex-designed `docs/brand/icon-1024.png`. Dark rounded tile (`#3a3125` → `#17120d`, `#4a3f30` edge at 70%), two amber corner brackets (top-left and bottom-right, gradient `#ffc657` → `#ffa31c`) and a red dot in the middle (radial `#ff8a73` / `#fb4535` / `#dc3022`, with a soft `--red` glow). Use the same gradients in the video.
- Geometry: tile `rect 128×128 rx 28`; brackets `M28 62V28h34` and `M100 66v34H66`, stroke 16, round caps and joins; dot `circle cx 64 cy 64 r 20`.
- The brackets read two ways: viewfinder corners (framing the moment) and the Chinese quote marks 「」 (keeping the line). The dot is "this moment".
- In the video it is drawn as inline SVG (scene 6) at 220px, so 1 icon unit = 1.71875px. Keep the icon's geometry; animate the parts (brackets, dot, tile), never redraw them.

## Colors
| Token | Hex | Use |
|---|---|---|
| `--ink-950` | `#0b0a09` | Page / cinema black |
| `--ink-900` | `#141210` | Panels (note overlay), chips |
| `--ink-800` | `#1f1c18` | Fields, cards |
| `--film` | `#1c1813` | Film strip base |
| `--ink-100` | `#f5f2ef` | Main text |
| `--ink-300` | `#d9d2c7` | Secondary text |
| `--ink-500` | `#a8a093` | Muted labels (AA on ink-950) |
| `--line` | `#4a443c` | Key caps, field and chip borders |
| `--red` | `#f2483a` | Brand red (icon dot): record dot, "this moment" ring, primary buttons |
| `--red-ink` | `#b8281b` | Brand red darkened for text on the light LINE card (AA on `#f6f1e9`) |
| `--amber` | `#ffb547` | Icon brackets, film edge codes, highlights (`.hl`) |
| `--hole` | `#ebe1cd` | Sprocket holes |

No other reds. In particular no platform brand colors.

## Type
- `"Noto Sans TC", system-ui, sans-serif`; times and key caps in `ui-monospace, "SF Mono", Menlo, monospace`.
- Noto Sans TC (SIL OFL 1.1, variable `wght` 100–900) ships as a subset, `assets/fonts/NotoSansTC-subset.woff2`, holding only the glyphs this video uses. After changing any copy, regenerate it from the full font (Google Fonts "Noto Sans TC", here `~/Library/Fonts/NotoSansTC-VariableFont_wght.ttf`):
  ```sh
  python3 -c "s=open('index.html',encoding='utf8').read();print(''.join(sorted(set(c for c in s if ord(c)>127))))" > /tmp/chars.txt
  python3 -m fontTools.subset NotoSansTC-VariableFont_wght.ttf --text-file=/tmp/chars.txt \
    --unicodes=U+0020-007E,U+00A0,U+00B7,U+2026,U+3000 --layout-features='*' --name-IDs='*' \
    --flavor=woff2 --output-file=assets/fonts/NotoSansTC-subset.woff2
  ```
  `--name-IDs='*'` keeps the copyright and license in the font file.
- 1080p floors: hero 168px+, scene heads 88–104px, eyebrows 28px, body 32px, badges/chips 22px+.

## Motion
- `power2.out` entrances, 0.5–0.6s; scene crossfades 0.45s with `display:none` after.
- Shutter flash (white, ~0.4s total) when a moment is captured: full screen in the overlay scene, per card in the platforms scene, and once at the brand close.
- Brand close: viewfinder brackets frame a full-screen still, then close in to become the icon's brackets while the still shrinks (circular clip) into the dot; the dot lights red with the shutter flash, then the tile, wordmark and tagline arrive.

## Platforms
- The extension works on Netflix, YouTube and Disney+. Show all three with equal weight; never imply it is for one platform only.
- Platform names are plain text in this video's own type and colors (neutral chip: `--ink-100` on `--ink-900`, `--line` border). No platform logos, wordmarks, brand colors, real UI or real show footage.
- Stills are original (generated); show titles and lines are made up.

## Rules
- Local-first: notes live in the user's browser. Never imply a server, an account or cloud sync.
