import assert from 'node:assert/strict'
import test from 'node:test'
import { blockText, copyBlocks, orgBlocks, otherCopyIds, sha256, withCopyBlocks } from '../src/bot-blocks.ts'
import { bundleFromState, parseSeatMarkdown, type SeatDocument } from '../src/org-files.ts'

const BASE = { copyId: '3s53', orgId: 'org-test', orgName: 'Desk', orgsFolder: 'C:\\Users\\me\\orgs', timeZone: 'Europe/Madrid' }

const SECURITY = `=== BotsEverywhere 3s53 org-test ===
Organization: Desk
Seat file: C:\\Users\\me\\orgs\\org-test\\seats\\security.md
Main manager: Inner Loop (id inner)
Also reports to: Outer Loop (id outer)
Skills to use: none
Processes: none
Take work only from your managers above. Send each result to the manager who gave you the work. When that is not your main manager, also send your main manager one line on what you did.
When a manager is a person, keep the result in your chat for them.
Before each run of a routine, read your seat file and your process files.
Run log: C:\\Users\\me\\orgs\\org-test\\log\\YYYY-MM-DD.md, in local time for Europe/Madrid. If the file is missing, start it with "# Run log YYYY-MM-DD".
After each step of a routine, append exactly one line:
- HH:MM | Security | <process name> | <step> | done|failed|skipped|waiting|running | note or -
Each time someone uses you in a chat for this organization, append exactly one line:
- HH:MM | Security | chat | what you were asked, in a few words | done|failed|waiting | note or -
Before a checkpoint, write waiting and ask the owner before you continue.
For Desk, this block replaces anything else in your instructions or memory about who you report to, whom you brief, which skills you use, and how you log.
=== end BotsEverywhere 3s53 org-test ===`

test('the block for a bot with a main and an extra manager is exactly the agreed text', () => {
  const text = blockText({
    ...BASE,
    botName: 'Security',
    seatFile: 'C:\\Users\\me\\orgs\\org-test\\seats\\security.md',
    main: { kind: 'bot', name: 'Inner Loop', id: 'inner' },
    also: [{ kind: 'bot', name: 'Outer Loop', id: 'outer' }],
    team: [],
    skills: [],
    processFiles: [],
  })
  assert.equal(text, SECURITY)
})

function seat(slug: string, lines: string): SeatDocument {
  const parsed = parseSeatMarkdown(slug, `---\n${lines}\n---\n\n## Owns\nWork\n`)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  return parsed.seat
}

function desk() {
  const seats = [
    seat('you', 'title: You\nkind: human\nreportsTo: ""\npersonId: person-you'),
    seat('inner-loop', 'title: Inner Loop\nkind: bot\nreportsTo: you\nskills: "[{\\"name\\":\\"Review\\"},{\\"name\\":\\"Plan\\"}]"'),
    seat('outer-loop', 'title: Outer Loop\nkind: bot\nreportsTo: you'),
    seat('security', 'title: Security\nkind: bot\nreportsTo: inner-loop\nalsoReportsTo: "[\\"outer-loop\\"]"'),
    seat('ux', 'title: UX\nkind: bot\nreportsTo: inner-loop'),
    seat('old-bot', 'title: Old Bot\nkind: bot\nreportsTo: inner-loop\nstatus: retired\nretiredAt: "2026-10-20T10:00:00.000Z"'),
  ]
  const bundle = bundleFromState('org-test', {
    company: { name: 'Desk' },
    departments: [],
    people: [{ id: 'person-you', name: 'Miguel Rovira' }],
    seats: seats.map((item) => ({ slug: item.slug, reportsTo: item.reportsTo || null })),
  }, seats, { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] })
  bundle.processes = [{ slug: 'weekly-check', name: 'Weekly check', trigger: { type: 'schedule', schedule: '0 9 * * 1', description: '' }, steps: [{ seat: 'inner-loop', action: 'Check' }], doneWhen: '', next: '', notes: '' }]
  const ids: Record<string, string> = { 'inner-loop': 'inner', 'outer-loop': 'outer', security: 'security' }
  return orgBlocks({ ...BASE, bundle, botFor: (slug) => (ids[slug] ? { name: bundle.seats.find((item) => item.slug === slug)!.title, id: ids[slug]! } : null) })
}

test('orgBlocks gives every active bot one block; managers list their team; people are named; retired seats are left out', () => {
  const blocks = desk()
  assert.deepEqual([...blocks.keys()].sort(), ['inner-loop', 'outer-loop', 'security', 'ux'])
  const inner = blocks.get('inner-loop')!
  assert.match(inner, /\nMain manager: Miguel Rovira\n/)
  assert.match(inner, /\nYour team: Security \(id security, main manager: you\), UX \(not in Grok Bot yet, main manager: you\)\n/)
  assert.match(inner, /\nSkills to use: Review, Plan\n/)
  assert.match(inner, /\nProcesses: C:\\Users\\me\\orgs\\org-test\\processes\\weekly-check\.md\n/)
  assert.match(inner, /\nBrief your team with SendToAgent\. Give work only to bots in your team\.\n/)
  assert.match(blocks.get('outer-loop')!, /\nYour team: Security \(id security, also reports to you\)\n/)
  assert.equal(blocks.get('security'), SECURITY)
  assert.doesNotMatch(blocks.get('ux')!, /Your team|Brief your team/)
})

const OWNER = 'Runs the C:\\shared\\drive check · weekly 🙂\r\nKeep it short.\r\n'

test('withCopyBlocks keeps every character outside its blocks, and writing the same blocks twice changes nothing', () => {
  const first = withCopyBlocks(OWNER, '3s53', [{ org: 'org-test', text: SECURITY }])
  assert.ok(first.ok)
  assert.equal(first.text, `${OWNER}\n\n${SECURITY}`)
  const again = withCopyBlocks(first.text, '3s53', [{ org: 'org-test', text: SECURITY }])
  assert.ok(again.ok)
  assert.equal(again.text, first.text)
  const removed = withCopyBlocks(first.text, '3s53', [])
  assert.ok(removed.ok)
  assert.equal(removed.text, OWNER)
})

test("withCopyBlocks leaves another copy's block where it is", () => {
  const theirs = '=== BotsEverywhere uft5 org-old ===\nMain manager: Pera Shaw\n=== end BotsEverywhere uft5 org-old ==='
  const start = `${OWNER}\n\n${theirs}\n\n${SECURITY}`
  const removed = withCopyBlocks(start, '3s53', [])
  assert.ok(removed.ok)
  assert.equal(removed.text, `${OWNER}\n\n${theirs}`)
  assert.deepEqual(otherCopyIds(start, '3s53'), ['uft5'])
  const parsed = copyBlocks(start, '3s53')
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.blocks.map((item) => item.org), ['org-test'])
})

test('a block at the very start of the text is removed with the space after it', () => {
  const start = `${SECURITY}\n\n${OWNER}`
  const removed = withCopyBlocks(start, '3s53', [])
  assert.ok(removed.ok)
  assert.equal(removed.text, OWNER)
})

test('repeated, unpaired, or crossed markers are refused, so a damaged text is never rewritten', () => {
  const open = '=== BotsEverywhere 3s53 org-test ==='
  const close = '=== end BotsEverywhere 3s53 org-test ==='
  for (const bad of [
    `${OWNER}${open}\nMain manager: X`,
    `${OWNER}Main manager: X\n${close}`,
    `${SECURITY}\n\n${SECURITY}`,
    `${open}\n=== BotsEverywhere 3s53 org-b ===\n${close}\n=== end BotsEverywhere 3s53 org-b ===`,
  ]) {
    assert.equal(copyBlocks(bad, '3s53').ok, false, bad.slice(0, 60))
    assert.equal(withCopyBlocks(bad, '3s53', []).ok, false)
  }
})

test('sha256 hashes the UTF-8 bytes the way the Connector will with python3', () => {
  assert.equal(sha256('Test bot. Do nothing.\nBotsEverywhere (3s53) · Test org: reports to Beta'), 'd4b5c51f804b37f9419fa53f612d7ae15657fd59ed575800182fbd691e684c0f')
})
