import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  ORG_CARD_TEXT_PX,
  ORG_TAG_FLOOR_PX,
  ORG_TAG_PX,
  ORG_TEXT_FLOOR_PX,
  effectiveFontPx,
  flooredFontPx,
  formatZoom,
} from '../../src/components/org-zoom.ts'

const root = path.resolve(import.meta.dirname, '../..')
const fitZoom = ORG_TEXT_FLOOR_PX / ORG_CARD_TEXT_PX

test('T1 keeps tags at 11px and body text at 12px when zoom is 85.7%', () => {
  assert.equal(ORG_TAG_PX, 12)
  assert.equal(ORG_TAG_FLOOR_PX, 11)
  assert.equal(formatZoom(fitZoom), '86%')
  const tags = effectiveFontPx(ORG_TAG_PX, ORG_TAG_FLOOR_PX, fitZoom)
  const body = effectiveFontPx(ORG_CARD_TEXT_PX, ORG_TEXT_FLOOR_PX, fitZoom)
  assert.ok(Math.abs(tags - 11) < 1e-9, String(tags))
  assert.ok(body >= 12)
  assert.equal(flooredFontPx(ORG_TAG_PX, ORG_TAG_FLOOR_PX, 1), ORG_TAG_PX)
  assert.equal(flooredFontPx(ORG_CARD_TEXT_PX, ORG_TEXT_FLOOR_PX, 1), ORG_CARD_TEXT_PX)
  assert.ok(effectiveFontPx(ORG_TAG_PX, ORG_TAG_FLOOR_PX, 0.2) >= 11)
  assert.ok(effectiveFontPx(ORG_CARD_TEXT_PX, ORG_TEXT_FLOOR_PX, 0.2) >= 12)

  const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
  assert.match(css, /max\(var\(--tag-size\), calc\(var\(--org-tag-floor\) \/ var\(--org-zoom\)\)\)/)
  assert.match(css, /max\(var\(--text-xs\), calc\(var\(--org-tag-floor\) \/ var\(--org-zoom\)\)\)/)
  assert.match(css, /max\(var\(--text-sm\), calc\(var\(--org-body-floor\) \/ var\(--org-zoom\)\)\)/)
  const chart = readFileSync(path.join(root, 'src/components/OrgChart.tsx'), 'utf8')
  assert.match(chart, /--org-zoom/)
})

test('T2 zoom readout shows the actual chart zoom', () => {
  assert.equal(formatZoom(1), '100%')
  assert.equal(formatZoom(0.857), '86%')
  assert.equal(formatZoom(fitZoom), '86%')
  const chart = readFileSync(path.join(root, 'src/components/OrgChart.tsx'), 'utf8')
  assert.match(chart, /\{formatZoom\(scale\)\}/)
  assert.equal(chart.includes('aria-label="100%"'), false)
  assert.equal(chart.includes('>100%<'), false)
})

test('the header and footer use the Org Bracket lockup, favicon, and social image', () => {
  const logo = readFileSync(path.join(root, 'src/components/Logo.tsx'), 'utf8')
  const html = readFileSync(path.join(root, 'index.html'), 'utf8')
  const css = readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8')
  const app = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
  const footer = readFileSync(path.join(root, 'src/components/AppFooter.tsx'), 'utf8')
  assert.match(logo, /src = size === 'sm' \? '\/mark-favicon-ink\.svg' : '\/lockup-ink\.svg'/)
  assert.equal(logo.includes('logotype-ink'), false)
  assert.equal(logo.includes('logo-j'), false)
  assert.match(footer, /src="\/mark-ink\.svg"/)
  assert.match(footer, />BotsEverywhere</)
  assert.match(footer, /<Logo \/>/)
  assert.equal(footer.includes('lockup-ink'), false)
  assert.match(html, /href="\/favicon\.ico"/)
  assert.match(html, /href="\/favicon\.svg"/)
  assert.match(html, /href="\/apple-touch-icon\.png"/)
  assert.match(html, /href="\/site\.webmanifest"/)
  assert.match(html, /property="og:image" content="\/og-image\.png"/)
  assert.equal(html.includes('twitter:image'), false)
  assert.equal(html.includes('logotype'), false)
  assert.match(css, /--logo-nav: 28px/)
  assert.match(css, /--logo-footer: 40px/)
  assert.equal(css.includes('--logo-min'), false)
  assert.equal(css.includes('--logo-nav-mobile'), false)
  assert.equal(app.includes('logotype'), false)
  assert.equal(app.includes('--logo-min'), false)
  for (const file of [
    'public/lockup-ink.svg',
    'public/mark-favicon-ink.svg',
    'public/favicon.ico',
    'public/favicon.svg',
    'public/apple-touch-icon.png',
    'public/og-image.png',
  ]) {
    assert.equal(readFileSync(path.join(root, file)).byteLength > 0, true, file)
  }
  for (const gone of ['public/brand/logotype-ink.svg', 'public/brand/logo-j/mark.svg']) {
    assert.throws(() => readFileSync(path.join(root, gone)))
  }
})
