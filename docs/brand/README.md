# ResonNote brand assets

The mark: two amber corner brackets (camera viewfinder corners that are also the Chinese quote
marks 「」) around a red dot for *this moment*. Colours: amber `#ffb547`, brand red `#f2483a`,
cinema black `#0b0a09` / `#141210`. Never Netflix red `#e50914`, never a platform logo.

| File | What it is | Used by |
|---|---|---|
| `icon-1024.png` | Master icon, designed with Codex (image generation) | `public/icon/*.png` (extension), store icon |
| `icon.svg` | Vector twin of the master, colours sampled from it | website `BrandMark` (animated in the hero) |
| `icon-16.svg` | Simplified flat mark for tab size | website `favicon.svg` |
| `favicon-32.png`, `apple-touch-icon-180.png` | Raster web icons cut from the master | `website/public/` |
| `og-1200x630.png` | Social share card | `website/public/og.png` |
| `social-preview-1280x640.png` | GitHub social preview (upload in repo Settings → Social preview) | GitHub |
| `codex/promo-background.jpg` | Codex-generated background art (no text) behind the share cards and store promo tiles | regenerating those images |
| `codex/prompts.md` | The Codex prompts and how candidates were scored | provenance |

Text on the cards is typeset by script (Noto Sans TC), not drawn by the image model. The
extension icon sizes were downscaled from the master (16 px with Mitchell and a light unsharp
mask, the rest with Lanczos). Chrome Web Store images live in `docs/store/images/`.
