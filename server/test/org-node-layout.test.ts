import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { chromium, type Page } from 'playwright'

const base = 'http://127.0.0.1:5199'
const MIN_WIDTH = 200

test('org chart nodes stay at least 200px wide and do not overlap', { timeout: 120_000 }, async () => {
  const server = await ensureServer()
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
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
      await assertChart(page, '/#o/your-company/org', viewport.width, false)
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
    if (server) server.kill('SIGTERM')
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

async function ensureServer(): Promise<ReturnType<typeof spawn> | null> {
  if (await reachable()) return null
  const child = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), stdio: 'ignore', detached: false })
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
