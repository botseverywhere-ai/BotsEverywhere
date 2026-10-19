import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  CREDIT,
  PRINCIPLES,
  UNSTAFFED_LINE,
  drawerRuleStatus,
  emptyHireTitle,
  firstEmptySection,
  mustAskCoversAbsolute,
} from '../../src/content/principles.ts'

const root = path.resolve(import.meta.dirname, '../..')

const SPEC_STRINGS = [
  'Seat card first: Owns / May / Needs approval / Done when, before any hire.',
  'One job per bot.',
  'Return finished work, not chat.',
  'Needs approval: send, post, spend, merge, deploy, DNS, secrets, delete, new access.',
  'Least privilege.',
  'Never invent.',
  'Stay in lane.',
]

const filled = {
  owns: 'Match invoices',
  may: 'Read records',
  mustAskBefore: 'Approving a payment',
  doneWhen: 'Every invoice is marked',
  acknowledged: false,
}

test('the seven principles match the spec verbatim', () => {
  assert.deepEqual(PRINCIPLES.map((item) => item.text), SPEC_STRINGS)
  assert.deepEqual(
    PRINCIPLES.map((item) => item.label),
    [
      'Seat card first',
      'One job per bot',
      'Finished work, not chat',
      'Needs approval',
      'Least privilege',
      'Never invent',
      'Stay in lane',
    ],
  )
})

test('the credit names the source and does not claim an endorsement', () => {
  assert.equal(CREDIT.text, 'Principles adapted from How to Hire Your First AI Employee (@distortgeekin)')
  assert.equal(CREDIT.short, 'Adapted from @distortgeekin')
  assert.equal(CREDIT.url, 'https://x.com/distortgeekin/status/2105275395901726845')
  assert.equal(/endors/i.test(CREDIT.text), false)
})

test('principles are constants: no fetch and no local storage', () => {
  const files = ['src/content/principles.ts', 'src/components/PrinciplesStrip.tsx', 'src/components/SeatCardCue.tsx']
  for (const file of files) {
    const text = readFileSync(path.join(root, file), 'utf8')
    assert.equal(/\bfetch\s*\(/.test(text), false, file)
    assert.equal(text.includes('localStorage'), false, file)
  }
  const strip = readFileSync(path.join(root, 'src/components/PrinciplesStrip.tsx'), 'utf8')
  assert.match(strip, /sessionStorage/)
  assert.doesNotMatch(strip, /localStorage/)
})

test('unstaffed seats use the seat-card line', () => {
  assert.equal(UNSTAFFED_LINE, 'Seat card first: Owns / May / Needs approval / Done when.')
  const cue = readFileSync(path.join(root, 'src/components/SeatCardCue.tsx'), 'utf8')
  const chart = readFileSync(path.join(root, 'src/components/OrgChart.tsx'), 'utf8')
  assert.match(cue, /UNSTAFFED_LINE/)
  assert.match(cue, /\+ Hire/)
  assert.match(chart, /SeatCardCue/)
})

test('seat card still gates a hire, and must-ask accepts the list or a tick', () => {
  assert.equal(firstEmptySection({ ...filled, owns: '  ' }), 'Owns')
  assert.equal(firstEmptySection(filled), null)
  assert.equal(emptyHireTitle('Owns'), 'Owns is empty. No card, no hire.')
  assert.equal(drawerRuleStatus('seat-card', { ...filled, doneWhen: '' }), 'open')
  assert.equal(drawerRuleStatus('seat-card', filled), 'met')
  assert.equal(drawerRuleStatus('one-job', filled), 'guide')
  assert.equal(drawerRuleStatus('least', filled), 'guide')
  assert.equal(mustAskCoversAbsolute('send, post, spend, merge, deploy, DNS, secrets, delete, new access'), true)
  assert.equal(mustAskCoversAbsolute('send and post'), false)
  assert.equal(drawerRuleStatus('must-ask', filled), 'open')
  assert.equal(drawerRuleStatus('must-ask', { ...filled, acknowledged: true }), 'met')
  assert.equal(
    drawerRuleStatus('must-ask', {
      ...filled,
      mustAskBefore: 'send, post, spend, merge, deploy, DNS, secrets, delete, new access',
    }),
    'met',
  )
})

const MIGUEL_GUIDE = [
  'Hire a job, not a task. One sentence of ownership that stays true next month.',
  'Make the first job boring. Frequent enough to test, cheap enough to undo.',
  'Run the trial in text. Ask what it would do before letting it do anything.',
  'Define done before the first day. "Useful" is not a standard. A checkable list is.',
  'Give one key, not the keyring. Draw the line at reversibility, not importance.',
  'Probation is three runs. One success is an event. Reliability is a pattern.',
  'Promote on evidence. Five clean runs, rollback tested, zero unresolved side effects.',
  'Review every week. And fire the routines nobody would miss.',
]

test('how to hire a bot uses Miguel’s guide in the drawer and in docs', () => {
  const guide = readFileSync(path.join(root, 'src/content/hiring-guide.ts'), 'utf8')
  for (const line of MIGUEL_GUIDE) assert.ok(guide.includes(line), line)
  assert.match(guide, /How to hire a bot/)
  assert.match(guide, /Pick where this bot works in your Work chart\. You can change it later\./)
  const drawer = readFileSync(path.join(root, 'src/components/HireDrawer.tsx'), 'utf8')
  assert.match(drawer, /<HiringGuide collapsed/)
  assert.match(drawer, /STEP_ASSIGN_HELP/)
  assert.match(drawer, /Not yet/)
  assert.match(drawer, /is-busy/)
  assert.match(drawer, /be-hire-dots/)
  assert.match(drawer, /SaveAlert/)
  assert.doesNotMatch(drawer, /Add a bot from the directory/)
  assert.doesNotMatch(drawer, /Includes the absolute must-ask list/)
  assert.doesNotMatch(drawer, /Hiring rules/)
  assert.doesNotMatch(drawer, /Unassigned/)
  const docs = readFileSync(path.join(root, 'src/pages/DocsPage.tsx'), 'utf8')
  assert.match(docs, /id="hiring">Hiring/)
  assert.match(docs, /<HiringGuide/)
  const workspace = readFileSync(path.join(root, 'src/pages/Workspace.tsx'), 'utf8')
  assert.match(workspace, /HIRE_HIGHLIGHT_KEY/)
  assert.match(workspace, /was hired/)
  assert.match(workspace, /See your org chart/)
  assert.match(workspace, /hrefFor\(hireNotice\.orgSlug, false, 'org'\)/)
})
