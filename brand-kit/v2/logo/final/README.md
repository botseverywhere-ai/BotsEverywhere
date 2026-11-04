# BotsEverywhere logo: final (single source of truth)

Mark: **Org Bracket** (option G). One lead block on top, joined by a bracket to two blocks below.
Colors: **Ink `#111111`** and **Stone `#F4F2EE`**, nothing else. Wordmark: "BotsEverywhere" in Inter Medium, **converted to outlines** (no font dependency).
Regenerate with `node ../build-final.js` (the preview sheet was rendered separately in Playwright).

## Geometry
48-unit grid, every coordinate a whole unit. Top block is 16×14 at (16,4). The stem is 6×5, the bracket bar is 32×5 at y=23 with 5-unit legs, and the two report blocks are 14×14 at (4,30) and (30,30).
`mark-favicon-ink.svg` / `favicon.svg` / `favicon.ico` use a **favicon-optimized variant** drawn on a 16-px pixel grid (×3 units). It has a thicker bracket (6 units = 2 px at 16), larger blocks and a wider gap, so every edge is pixel-aligned at 16/32/48. Use it only below about 48 px.

## Clear space
Leave clear space around the mark or lockup **equal to the height of the top block** (14/48 of the mark height, about 0.3× mark height). Nothing goes inside it.

## Minimum sizes
- Mark: 24 px on screen / 8 mm in print. Below 24 px, use the favicon variant (16 px minimum).
- Lockup: 96 px wide on screen / 30 mm in print.

## Do
- Use ink on light backgrounds and stone on dark ones (or the tile files).
- Scale proportionally from the SVG masters.
## Don't
- Recolor beyond ink/stone. Don't use gradients, shadows, glows, outlines or other effects.
- Stretch, skew, rotate, or re-space the mark and wordmark.
- Retype the wordmark in a live font. Use the outlined SVG.

## Files
| File | Use |
|---|---|
| mark-ink.svg / mark-stone.svg | Mark, transparent (stone = for dark bg) |
| lockup-ink.svg / lockup-stone.svg | Mark + outlined wordmark, transparent |
| mark-on-stone.svg / mark-on-ink.svg | Filled rounded app tile |
| mark-{ink,stone}-{64,128,256,512,1024}.png | Transparent mark PNGs |
| lockup-{ink,stone}-{512,1024}w.png | Transparent lockup PNGs |
| mark-favicon-ink.svg | Pixel-grid small-size variant |
| favicon.ico (16/32/48), favicon.svg (switches to stone in dark mode) | Browser icons |
| apple-touch-icon.png (180), icon-192.png, icon-512.png | Ink mark on stone tile, 12.5% padding |
| icon-maskable-512.png | Mark inside the central 50% (within the 80% safe zone) |
| og-image.png | 1200×630 social card |
| logo-final-sheet.png | Preview on light and dark |

## HTML head
```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#F4F2EE">
<meta property="og:image" content="/og-image.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

## site.webmanifest
```json
{
  "name": "BotsEverywhere",
  "short_name": "BotsEverywhere",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "theme_color": "#F4F2EE",
  "background_color": "#F4F2EE",
  "display": "standalone"
}
```
