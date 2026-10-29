# scenenote promo — visual identity

Taken from the extension's own UI (note overlay, film strip, notebook), so the video looks like the product.

## Colors
| Token | Hex | Use |
|---|---|---|
| `--ink-950` | `#0b0a09` | Page / cinema black |
| `--ink-900` | `#141210` | Panels (note overlay) |
| `--ink-800` | `#1f1c18` | Fields, cards |
| `--film` | `#1c1813` | Film strip base |
| `--ink-100` | `#f5f2ef` | Main text |
| `--ink-300` | `#d9d2c7` | Secondary text |
| `--ink-500` | `#a8a093` | Muted labels (AA on ink-950) |
| `--red` | `#e50914` | "This moment" frame, record dot, primary button |
| `--amber` | `#ffb547` | Film edge codes, highlights (`.hl`) |
| `--hole` | `#ebe1cd` | Sprocket holes |

## Type
- `"Noto Sans TC", "PingFang TC", "Inter", system-ui, sans-serif`; times in `ui-monospace, Menlo`.
- 1080p floors: hero 168px+, scene heads 88–104px, eyebrows 28px, body 32px.

## Motion
- `power2.out` entrances, 0.5–0.6s; scene crossfades 0.5s with `display:none` after.
- One shutter flash (white, 0.15s) when the moment is captured.

## Rules
- No Netflix logo, UI or real show footage. Stills are original (generated), show titles are made up.
- Local-first: notes live in the user's browser. Never imply a server.
