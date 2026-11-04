import { expect, test } from '@playwright/test'

const ROUTES: { url: string; testId: 'org-chart' | 'work-chart'; title?: string }[] = [
  { url: '/#org', testId: 'org-chart' },
  { url: '/#work', testId: 'work-chart' },
  { url: '/#seat-you', testId: 'org-chart', title: 'You' },
  { url: '/#sample/harbor?view=org', testId: 'org-chart' },
  { url: '/#sample/bot-company-x?view=org', testId: 'org-chart' },
  { url: '/#sample/bot-company-x?view=work', testId: 'work-chart' },
  { url: '/#sample/meridian-ledger?view=org', testId: 'org-chart' },
  { url: '/#sample/meridian-ledger?view=work', testId: 'work-chart' },
]

test('seed and sample routes render the shared chart', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route.url, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId(route.testId)).toBeVisible()
    if (route.title) await expect(page.locator('#panel-title')).toHaveText(route.title)
  }
})
