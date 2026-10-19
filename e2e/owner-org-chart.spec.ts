import { expect, test } from '@playwright/test'

test('owner org chart reaches every seat by scrolling and search opens Design Bot', async ({ page }) => {
  await page.goto('/#sample/botseverywhere?view=org', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('org-chart')).toBeVisible()
  await page.locator('.org-zoom').getByRole('button', { name: /^\d+%$/ }).click()

  const nodes = page.locator('.org-card-hit')
  const count = await nodes.count()
  expect(count).toBeGreaterThan(10)
  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index)
    await node.scrollIntoViewIfNeeded()
    await expect(node).toBeVisible()
  }

  await page.getByLabel('Find seat').fill('Design Bot')
  await page.getByLabel('Find seat').press('Enter')
  await expect(page.locator('#panel-title')).toHaveText('Design Bot')
  await expect(page.locator('[data-seat-id="seat-design-bot"]')).toHaveClass(/found/)
})
