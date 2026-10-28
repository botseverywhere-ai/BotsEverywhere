import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { WORK_CHART_LOCKED, workChartLocked } from '../../src/org/work-chart-lock.ts'

async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(React.createElement(component as Parameters<typeof React.createElement>[0], props))
}

const you = { kind: 'human' as const, title: 'You' }
const connector = { kind: 'bot' as const, title: 'Connector - BotsEverywhere (acn8)' }
const bot = { kind: 'bot' as const, title: 'Inner Loop' }

test('the Work Chart opens once the organization has bots, as Step 2 of Connect bots says; a template always has it open', () => {
  assert.equal(workChartLocked([you], false), true)
  assert.equal(workChartLocked([you, connector], false), true, 'the Connector alone is not a connected bot')
  assert.equal(workChartLocked([you, connector, bot], false), false)
  assert.equal(workChartLocked([you], true), false)
  assert.equal(WORK_CHART_LOCKED, 'Connect bots to open the Work Chart')
})

test('a locked Work Chart tab is greyed out, says why on hover, and links nowhere; the other tabs stay links', async () => {
  const { OrgTabs } = await import('../../src/components/OrgTabs.tsx')
  const locked = await render(OrgTabs, { slug: 'desk', current: 'overview', template: false, workChartLocked: true })
  assert.match(locked, /<span class="is-locked" aria-disabled="true" tabindex="0" data-tip="Connect bots to open the Work Chart">Work Chart<span class="sr-only">: Connect bots to open the Work Chart<\/span><\/span>/)
  assert.equal(locked.includes('href="#/org/desk/work-chart"'), false)
  assert.match(locked, /href="#\/org\/desk\/connect-bots"/)
  const open = await render(OrgTabs, { slug: 'desk', current: 'overview', template: false, workChartLocked: false })
  assert.match(open, /href="#\/org\/desk\/work-chart"/)
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.org-tabs \.is-locked \{/)
  assert.match(css, /\.org-tabs \.is-locked:hover::after/)
})

test('the Work Chart page itself is blocked while locked, and Step 2 of Connect bots carries the same line as a badge', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /const chartLocked = workChartLocked\(seats, sample\)/)
  assert.match(workspace, /<OrgTabs slug=\{bundle\.id\} current=\{tabForView\(view\)\} template=\{sample\} workChartLocked=\{chartLocked\} \/>/)
  assert.match(workspace, /\{view === 'work' && chartLocked \? \(/)
  assert.match(workspace, /\{view === 'work' && !chartLocked \? \(/)
  const step = readFileSync(new URL('../../src/components/LinkCompany.tsx', import.meta.url), 'utf8')
  assert.match(step, /\{locked \? null : <span className="connect-badge"><i aria-hidden="true" \/>\{WORK_CHART_LOCKED\}<\/span>\}/)
})
