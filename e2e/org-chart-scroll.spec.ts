import { expect, test } from '@playwright/test'

test('releasing the mouse outside the window does not keep the org chart moving', async ({ page }) => {
  await page.goto('/#sample/meridian-ledger?view=org', { waitUntil: 'domcontentloaded' })
  const canvas = page.getByTestId('org-canvas')
  await expect(canvas).toBeVisible()
  await expect(page.getByRole('tree', { name: 'Org chart' })).toBeVisible()

  const point = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="org-canvas"]')
    if (!root) return null
    const rect = root.getBoundingClientRect()
    for (let y = rect.bottom - 8; y > rect.top + 8; y -= 8) {
      for (let x = rect.left + 8; x < rect.right - 8; x += 12) {
        const el = document.elementFromPoint(x, y)
        if (!el || el.closest('button, a, input, textarea, select')) continue
        if (el.closest('[data-testid="org-canvas"]')) return { x, y }
      }
    }
    return null
  })
  expect(point).not.toBeNull()

  const snapshot = () =>
    page.evaluate(() => {
      const root = document.querySelector('[data-testid="org-canvas"]') as HTMLElement
      const node = document.querySelector('.org-card-hit') as HTMLElement
      const rect = node.getBoundingClientRect()
      return {
        scrollLeft: root.scrollLeft,
        scrollTop: root.scrollTop,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
      }
    })

  await page.mouse.move(point!.x, point!.y)
  await page.mouse.down()
  await page.mouse.move(point!.x + 180, point!.y + 90, { steps: 12 })
  await page.mouse.move(point!.x - 40, point!.y + 140, { steps: 8 })
  await page.mouse.move(-30, -30)
  await page.mouse.up()

  const settled = await snapshot()
  await page.mouse.move(point!.x + 60, point!.y + 30, { steps: 10 })
  await page.mouse.move(point!.x + 220, point!.y + 80, { steps: 10 })
  await page.waitForTimeout(300)
  expect(await snapshot()).toEqual(settled)

  const node = page.locator('.org-card-hit').first()
  const label = (await node.getAttribute('aria-label')) ?? ''
  const name = label.split(',')[0]?.trim() ?? ''
  expect(name.length).toBeGreaterThan(0)
  await node.click()
  await expect(page.locator('#panel-title')).toHaveText(name)
})
