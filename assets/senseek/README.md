# Senseek Brand Assets

**Senseek**
Semantic Page Search
Find what you mean.

## Design

The mark combines a webpage outline, highlighted source text, and a search lens. It is designed to communicate “find and highlight meaning on this page” at both full size and browser-toolbar size.

## Files

| File | Purpose |
| --- | --- |
| `senseek-logo.svg` | Logo and wordmark for light backgrounds |
| `senseek-logo-inverse.svg` | Reversed logo and wordmark for dark backgrounds |
| `senseek-lockup.svg` | Full lockup with both taglines |
| `senseek-wordmark.svg` | Standalone wordmark |
| `senseek-mark.svg` / `senseek-mark-inverse.svg` | Standalone page-search mark |
| `senseek-icon.svg` / `senseek-icon-light.svg` | Rounded-square app icons |
| `senseek-logo-mono.svg` | Monochrome logo |
| `exports/*.png` | Transparent PNG exports |
| `exports/icon-16.png` and similar files | Browser and extension icons |
| `previews/*.png` | Brand and lockup previews |
| `senseek-logo-kit.zip` | Complete asset package |

The `-v2` files contain the latest page-search mark revision. SVG assets use outlined paths and do not require external fonts or network resources.

The extension uses this mark in the browser toolbar, settings page and favicon, and search panel. `npm run build` copies the approved SVG and 16/32/48/128px PNG exports into `extension/icons` and embeds the same SVG in the search panel. Chrome reads extension-page favicons from the manifest. The PNG filenames include a content hash, and the build updates the manifest so new artwork gets a fresh cache key. The 16px export includes optical adjustments for toolbar readability. `node scripts/sync-icons.mjs` or `python scripts/icons.py` can also sync the packaged icons on their own.

## Colors

- Forest: `#23483B`
- Highlight: `#D6EDAC`
- Paper: `#F6F7F1`

## Typeface and generation

The wordmark is based on Manrope 700. The font is distributed under the SIL Open Font License; see `source/OFL.txt`. Source: [Google Fonts / Manrope](https://github.com/google/fonts/tree/main/ofl/manrope).

Regenerate the assets from the repository root with Python `fontTools` and the project's Playwright dependency:

```sh
python scripts/design-senseek.py
node scripts/render-senseek.mjs
```
