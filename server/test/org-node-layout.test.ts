import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { copyTemplateOrg } from '../src/template-server.ts'

// CHROME_PATH runs it with another Chrome, like the one installed on Windows; without Chrome it is skipped.
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome'
// Its own ports, so a dev server already running on this computer is never used or disturbed.
const WEB_PORT = 5390
const WRITER_PORT = 8890
const base = `http://127.0.0.1:${WEB_PORT}`
const MIN_WIDTH = 200

test('org chart nodes stay at least 200px wide and do not overlap', { timeout: 120_000, skip: existsSync(CHROME) ? false : `needs Chrome at ${CHROME}` }, async () => {
  // An org of its own in a temporary orgs folder: orgs/ is each person's data and is not in git.
  const dir = mkdtempSync(join(tmpdir(), 'be-layout-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const copied = copyTemplateOrg(orgs, fileURLToPath(new URL('../../samples', import.meta.url)), 'corbett-construction')
  assert.ok(copied.ok, copied.ok ? '' : copied.errors.join(' '))
  const server = await startApp(orgs)
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  })
  try {
    const page = await browser.newPage()
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1600, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await assertChart(page, '/#sample/corbett-construction?view=org', viewport.width, true)
      await assertChart(page, `/#o/${copied.slug}/org`, viewport.width, false)
    }
    await page.goto(`${base}/#sample/corbett-construction?view=org`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.org-avatar-human')
    const initials = await page.locator('.org-avatar-human').first().evaluate((el) => {
      const tree = el.closest('.org-tree') as HTMLElement | null
      const zoom = Number(tree?.style.zoom || 1) || 1
      const font = Number.parseFloat(getComputedStyle(el).fontSize)
      return font * zoom
    })
    assert.ok(initials >= 11 - 0.05, `initials paint at ${initials}px`)
  } finally {
    await browser.close()
    server.kill('SIGTERM')
    rmSync(dir, { recursive: true, force: true })
  }
})

async function assertChart(page: Page, path: string, viewport: number, expectSiblings: boolean) {
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.org-node')
  await page.waitForFunction(() => {
    const tree = document.querySelector('.org-tree') as HTMLElement | null
    return Boolean(tree?.style.zoom)
  })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  const measured = await page.locator('.org-tree').evaluate((tree) => {
    const zoom = Number((tree as HTMLElement).style.zoom || 1) || 1
    const name = tree.querySelector('.org-name')
    const font = name ? Number.parseFloat(getComputedStyle(name).fontSize) : 0
    const groups: { label: string; layoutW: number; x: number; y: number; w: number; h: number }[][] = []
    const lists = [tree, ...tree.querySelectorAll('ul')]
    for (const list of lists) {
      const row: { label: string; layoutW: number; x: number; y: number; w: number; h: number }[] = []
      for (const item of list.children) {
        if (!(item instanceof HTMLLIElement) || item.getAttribute('role') === 'presentation') continue
        const node = item.querySelector(':scope > .org-node')
        const hit = node?.querySelector('.org-card-hit')
        if (!node || !hit) continue
        const hitBox = hit.getBoundingClientRect()
        row.push({
          label: hit.getAttribute('aria-label') || hit.textContent || '',
          layoutW: (node as HTMLElement).offsetWidth,
          x: hitBox.x,
          y: hitBox.y,
          w: hitBox.width,
          h: hitBox.height,
        })
      }
      if (row.length) groups.push(row)
    }
    return { zoom, text: font * zoom, groups }
  })

  const cards = measured.groups.flat()
  assert.ok(cards.length > 0, `${path} at ${viewport} has no org nodes`)
  for (const card of cards) {
    assert.ok(
      card.layoutW >= MIN_WIDTH,
      `${path} at ${viewport}: "${card.label.trim()}" node is ${card.layoutW}px wide`,
    )
  }
  assert.ok(
    measured.text >= 12,
    `${path} at ${viewport}: Fit text is ${measured.text}px (zoom ${measured.zoom})`,
  )
  const siblingRows = measured.groups.filter((row) => row.length > 1)
  if (expectSiblings) {
    assert.ok(siblingRows.length > 0, `${path} at ${viewport} has no sibling nodes`)
  }
  for (const row of siblingRows) {
    for (let i = 0; i < row.length; i++) {
      for (let j = i + 1; j < row.length; j++) {
        const a = row[i]!
        const b = row[j]!
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        assert.ok(
          overlapX <= 1 || overlapY <= 1,
          `${path} at ${viewport}: "${a.label.trim()}" overlaps "${b.label.trim()}" by ${overlapX}x${overlapY}`,
        )
      }
    }
  }
}

/** The site and the file writer, as npm run dev starts them, over the given orgs folder and on this test's own ports. */
async function startApp(orgs: string): Promise<ReturnType<typeof spawn>> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/dev-all.ts'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, ORGS_DIR: orgs, PORT: String(WRITER_PORT), WEB_PORT: String(WEB_PORT) },
    stdio: 'ignore',
    detached: false,
  })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await reachable()) return child
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  child.kill('SIGTERM')
  throw new Error('dev server did not start')
}

async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(base)
    return response.ok
  } catch {
    return false
  }
}
