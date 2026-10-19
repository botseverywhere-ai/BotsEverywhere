import { expect, test } from '@playwright/test'

const ROUTES: { url: string; testId: 'org-chart' | 'work-chart'; title?: string }[] = [
  { url: '/#org', testId: 'org-chart' },
  { url: '/#work', testId: 'work-chart' },
  { url: '/#seat-you', testId: 'org-chart', title: 'You' },
  { url: '/#sample/harbor?view=org', testId: 'org-chart' },
  { url: '/#sample/botseverywhere?view=org', testId: 'org-chart' },
  { url: '/#sample/botseverywhere?view=work', testId: 'work-chart' },
  { url: '/#sample/meridian-ledger?view=org', testId: 'org-chart' },
  { url: '/#sample/meridian-ledger?view=work', testId: 'work-chart' },
]

test('seed, sample, and owner routes render the shared chart', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route.url, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId(route.testId)).toBeVisible()
    if (route.title) await expect(page.locator('#panel-title')).toHaveText(route.title)
  }
})

test('intake builds the same work and org charts', async ({ page }) => {
  await page.goto('/#intake', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Classify → temporary chart' }).click()
  await expect(page.getByTestId('intake-chart').getByTestId('work-chart')).toBeVisible()
  await page.getByRole('tab', { name: 'Org' }).click()
  await expect(page.getByTestId('intake-chart').getByTestId('org-chart')).toBeVisible()
})

test('a share link renders the same chart components', async ({ page }) => {
  const seats = {
    seats: [
      { id: 'h', name: 'Founder', role: 'PM', botSlug: null, humanOwner: 'You', sortOrder: 0, kind: 'human' },
      { id: 'b', name: 'Research', role: 'Briefs', botSlug: 'research', humanOwner: '', sortOrder: 1, kind: 'bot', reportsTo: 'h' },
    ],
  }
  const emptyWork = { seats: seats.seats, workstreams: [], steps: [], handoffs: [], checkpoints: [] }
  await page.route('**/api/share/session', (route) =>
    route.fulfill({ json: { team: { id: 'team-e2e', access: 'view' } } }),
  )
  await page.route('**/api/teams/team-e2e', (route) =>
    route.fulfill({ json: { team: { name: 'Shared team', role: null } } }),
  )
  await page.route('**/api/teams/team-e2e/seats', (route) => route.fulfill({ json: seats }))
  await page.route('**/api/teams/team-e2e/work', (route) => route.fulfill({ json: emptyWork }))

  await page.goto('/#view-abcdefghijklmnopqrstuvwxyz?chart=org', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('org-chart')).toBeVisible()
  await page.goto('/#view-abcdefghijklmnopqrstuvwxyz?chart=work', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('work-chart')).toBeVisible()
})
