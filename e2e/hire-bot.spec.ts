import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

const root = 'orgs/your-company'
const orgPath = `${root}/org.md`
const workPath = `${root}/work-chart.md`
const logDir = `${root}/log`
const youPath = `${root}/seats/you.md`

test('hiring Invoice Bot writes the seat file and shows it on the org chart', async ({ page }) => {
  await hireFromDirectory(page, 'invoice-bot', 'Invoice Bot')
})

test('hiring Role Card Bot from its directory page writes the seat', async ({ page }) => {
  await hireFromDirectory(page, 'role-card-bot', 'Role Card Bot')
})

async function hireFromDirectory(page: Page, slug: string, name: string) {
  const seatPath = `${root}/seats/${slug}.md`
  const snapshot = {
    org: readFileSync(orgPath, 'utf8'),
    work: readFileSync(workPath, 'utf8'),
    logs: existsSync(logDir) ? readdirSync(logDir).filter((name) => name.endsWith('.md')).map((name) => ({ name, text: readFileSync(`${logDir}/${name}`, 'utf8') })) : [],
    you: existsSync(youPath) ? readFileSync(youPath, 'utf8') : '',
    seat: existsSync(seatPath) ? readFileSync(seatPath, 'utf8') : null,
  }
  if (existsSync(seatPath)) unlinkSync(seatPath)
  try {
    await page.goto(`/#/directory/${slug}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    const open = page.getByRole('button', { name: 'Hire into team' })
    await expect(open).toBeEnabled()
    await expect(page.locator('.dir-hire-reason')).toHaveCount(0)
    await open.click()
    const submit = page.locator('.be-hire-submit')
    await expect(submit).toBeEnabled()
    await submit.click()
    const notice = page.locator('.be-hire-notice')
    await expect(notice).toContainText(`${name} was hired`)
    await expect(notice.getByRole('link', { name: 'See your org chart' })).toBeVisible()
    expect(existsSync(seatPath)).toBe(true)
    expect(readFileSync(seatPath, 'utf8')).toContain(`title: ${name}`)
    await page.goto('/#o/your-company/org', { waitUntil: 'domcontentloaded' })
    const card = page.locator(`[data-seat-id="${slug}"]`)
    await expect(card).toBeVisible()
    await expect(card).toHaveClass(/is-hired/)
  } finally {
    if (snapshot.seat !== null) writeFileSync(seatPath, snapshot.seat)
    else if (existsSync(seatPath)) unlinkSync(seatPath)
    writeFileSync(orgPath, snapshot.org)
    writeFileSync(workPath, snapshot.work)
    mkdirSync(logDir, { recursive: true })
    for (const name of readdirSync(logDir).filter((item) => item.endsWith('.md'))) {
      if (!snapshot.logs.some((item) => item.name === name)) unlinkSync(`${logDir}/${name}`)
    }
    for (const item of snapshot.logs) writeFileSync(`${logDir}/${item.name}`, item.text)
    if (snapshot.you) writeFileSync(youPath, snapshot.you)
  }
}
