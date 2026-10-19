import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { botBlurb, orgCardLabel, taskNote } from '../../src/components/org-card-copy.ts'
import type { Seat } from '../../src/data/mock-companies.ts'

function bot(patch: Partial<Seat> = {}): Seat {
  return {
    id: 'inbox-bot',
    orgId: 'org',
    name: 'Inbox Bot',
    role: 'Inbox Bot',
    type: 'bot',
    curated: true,
    card: { owns: ['Sort the morning batch'], may: [], mustAskBefore: [], doneWhen: [] },
    ...patch,
  }
}

test('org chart blurbs use a description, then the first Owns line', () => {
  assert.equal(botBlurb(bot()), 'Sort the morning batch')
  assert.equal(botBlurb(bot({ description: '  Reads the inbox before anyone replies. ' })), 'Reads the inbox before anyone replies.')
  assert.equal(botBlurb(bot({ card: { owns: ['  ', ''], may: [], mustAskBefore: [], doneWhen: [] }, role: 'Triage' })), 'Triage')
  assert.equal(botBlurb(bot({ card: { owns: [], may: [], mustAskBefore: [], doneWhen: [] }, role: 'Inbox Bot' })), '')
  assert.equal(orgCardLabel(bot()), 'Inbox Bot, Sort the morning batch, bot')
  assert.equal(orgCardLabel(bot({ card: { owns: [], may: [], mustAskBefore: [], doneWhen: [] } })), 'Inbox Bot, bot')
})

test('org chart task counts come from the live log, not from hire events', () => {
  const quiet = bot({ stats: { usageCount30d: 0, tasksDone30d: 0, lastActiveAt: '' } })
  assert.equal(taskNote(quiet, undefined, false), '0 tasks/30d')
  const live = bot({
    stats: { usageCount30d: 0, tasksDone30d: 0, lastActiveAt: '' },
    shown: { createdAt: '', lastActive: '2026-10-17T22:20:00.000Z', usage: 2, tasks: 1 },
  })
  assert.equal(taskNote(live, undefined, false), '1 tasks/30d')
  const unknown = bot({ shown: { createdAt: '', lastActive: '', usage: null, tasks: null } })
  assert.equal(taskNote(unknown, undefined, false), '0 tasks/30d')
  assert.equal(taskNote(live, 'inbox-bot', true), '1 tasks/30d · Least used · sample')

  const chart = readFileSync(fileURLToPath(new URL('../../src/components/OrgChart.tsx', import.meta.url)), 'utf8')
  assert.equal(chart.includes('function taskNote'), false)
  assert.match(chart, /import \{ botBlurb, orgCardLabel, taskNote \} from '\.\/org-card-copy'/)
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/Workspace.tsx', import.meta.url)), 'utf8')
  assert.match(page, /shown: metricsById\.get\(seat\.id\)[\s\S]{0,200}\.\.\.openSeats\]/)
})
