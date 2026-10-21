import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createExistingBot, createHiredSeat, createOrgFiles, readOrgDir, updateSeatProfile } from '../src/template-server.ts'
import { companyFromBundle } from '../../src/org/company.ts'
import { CRON_PRESETS, IMPORTED_NOTE, INSTRUCTIONS_LABEL, INSTRUCTIONS_PLACEHOLDER, START_LABELS, cronText, draftRoutines, draftRows, profileParts, promptToSave, startLine } from '../../src/components/bot-profile-copy.ts'

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const CARD = { owns: ['Sorting new leads'], may: ['Read the lead list'], mustAskBefore: ['Contacting a lead'], doneWhen: ['Every lead is marked'] }

test('each bot tells where it came from, and carries its Profile to the panel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-profile-ui-'))
  try {
    const orgs = join(dir, 'orgs')
    mkdirSync(orgs)
    const made = createOrgFiles(orgs, 'Desk', 'You')
    assert.ok(made.ok)
    const root = join(orgs, made.slug)
    assert.ok(createHiredSeat(root, made.slug, { name: 'Lead Sorter', kind: 'bot', slug: 'lead-sorter', directorySlug: '', reportsTo: 'you', addToGrokBotUrl: '', ...CARD }).ok)
    assert.ok(createHiredSeat(root, made.slug, { name: 'Code Review Bot', kind: 'bot', slug: 'code-review-bot', directorySlug: 'code-review-bot', reportsTo: 'you', addToGrokBotUrl: '', ...CARD }).ok)
    assert.ok(createExistingBot(root, made.slug, { name: 'Grok Bot', grokBotUrl: 'grokbot://app/v1/agent?id=1', reportsTo: 'you', allowEmptyCard: true, skills: [{ name: 'Route', description: 'Send a task to the right bot.' }], publicUrl: 'https://x.ai/bot/grok-bot' }).ok)
    assert.ok(updateSeatProfile(root, made.slug, 'lead-sorter', { instructions: 'Sort leads.', routines: [{ name: 'Sweep', schedule: 'Weekdays 09:00', description: 'Sweep new leads.' }] }).ok)
    const read = readOrgDir(root, made.slug)
    assert.ok(read.ok)
    const seats = companyFromBundle(read.bundle).seats
    const seat = (id: string) => seats.find((item) => item.id === id)!
    assert.equal(seat('lead-sorter').origin, 'manual')
    assert.equal(seat('code-review-bot').origin, 'directory')
    assert.equal(seat('code-review-bot').directoryId, 'code-review-bot')
    assert.equal(seat('grok-bot').origin, 'imported')
    assert.equal(seat('lead-sorter').instructions, 'Sort leads.')
    assert.deepEqual(seat('lead-sorter').routines, [{ name: 'Sweep', schedule: 'Weekdays 09:00', description: 'Sweep new leads.' }])
    assert.deepEqual(seat('grok-bot').skills, [{ name: 'Route', description: 'Send a task to the right bot.' }])
    assert.equal(seat('grok-bot').publicUrl, 'https://x.ai/bot/grok-bot')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Profile shows how each kind of bot works: a note for imported bots, the editable prompt for the rest', () => {
  assert.equal(IMPORTED_NOTE, 'This seat is not in the directory. It was imported from Grok Bot.')
  assert.equal(INSTRUCTIONS_LABEL, 'Instructions for Grok Bot')
  assert.equal(INSTRUCTIONS_PLACEHOLDER, 'What this bot should do, in your words…')
  assert.deepEqual(profileParts({ origin: 'imported', grokSync: 'synced', grokBotUrl: 'grokbot://x' }), { note: IMPORTED_NOTE, prompt: 'none', listsEditable: false, addToGrok: false })
  assert.deepEqual(profileParts({ origin: 'directory' }), { note: '', prompt: 'directory', listsEditable: true, addToGrok: false })
  assert.deepEqual(profileParts({ origin: 'manual' }), { note: '', prompt: 'instructions', listsEditable: true, addToGrok: true }, 'a bot added by hand and not in Grok Bot yet')
  assert.equal(profileParts({ origin: 'manual', grokSync: 'synced' }).addToGrok, false, 'once in Grok Bot there is nothing to add')
  assert.equal(profileParts({ origin: 'manual', grokBotUrl: 'grokbot://x' }).addToGrok, false)
})

test('an unedited directory prompt is not saved, so the directory stays the source; empty rows are left out', () => {
  assert.equal(promptToSave('You sort new leads.\n', 'You sort new leads.'), '', 'unchanged from the directory')
  assert.equal(promptToSave('You sort EU leads.', 'You sort new leads.'), 'You sort EU leads.')
  assert.equal(promptToSave('  Do this.  ', ''), 'Do this.')
  assert.deepEqual(draftRows([{ name: ' Lead sort ', description: ' x ' }, { name: '', description: 'no name' }, { name: 'Recap', description: '' }]), [{ name: 'Lead sort', description: 'x' }, { name: 'Recap' }])
})

test('the panel opens the new Profile only on your own organizations, and leaves the Seat card and Reports to as they are', () => {
  const drawer = source('../../src/components/SeatDrawer.tsx')
  assert.match(drawer, /tab === 'profile' && seat\.type === 'bot' && onProfile \? \(\s*<BotProfile/)
  assert.match(drawer, /<CardEditor title="Owns"/, 'the Seat card still edits Owns')
  assert.match(drawer, /<select className="text-input" value=\{seat\.reportsTo\} onChange=\{\(event\) => onReportsTo\(event\.target\.value\)\}>/, 'Reports to is the same select')
  assert.match(drawer, /<RoutineList routines=\{seat\.routines\} \/>/, 'the Seat card keeps its routine list')
  const profile = source('../../src/components/BotProfile.tsx')
  for (const text of ['{IMPORTED_NOTE}', '{INSTRUCTIONS_LABEL}', 'placeholder={INSTRUCTIONS_PLACEHOLDER}', '+ Add skill', '+ Add routine', 'Get this bot', 'Add to Grok Bot']) assert.ok(profile.includes(text), text)
  const workspace = source('../../src/pages/Workspace.tsx')
  assert.match(workspace, /onProfile=\{editable \?/)
  assert.doesNotMatch(workspace, /onGrokUrl=/, 'nobody edits the public link in the app')
  assert.match(workspace, /\/seats\/\$\{slug\}\/profile`/)
})

test('a cron schedule reads in plain words, and the presets read the same way', () => {
  assert.equal(cronText('0 9 * * 1-5'), 'Every weekday at 9:00 AM')
  assert.equal(cronText('15 18 * * 1-5'), 'Every weekday at 6:15 PM')
  assert.equal(cronText('0 9 * * *'), 'Every day at 9:00 AM')
  assert.equal(cronText('30 14 * * 1'), 'Every Monday at 2:30 PM')
  assert.equal(cronText('0 9 * * 1,3,5'), 'Every Monday, Wednesday, and Friday at 9:00 AM')
  assert.equal(cronText('0 0 1 * *'), 'On day 1 of every month at 12:00 AM')
  assert.equal(cronText('0 * * * *'), 'Every hour')
  assert.equal(cronText('*/15 * * * *'), 'Every 15 minutes')
  assert.equal(cronText('0 */2 * * *'), 'Every 2 hours')
  assert.equal(cronText('5 4 * 2 *'), 'Custom schedule')
  assert.equal(cronText('Mon 09:00'), '', 'an older schedule in words gets no second line')
  assert.ok(CRON_PRESETS.some((preset) => preset.cron === '0 9 * * 1-5'))
  for (const preset of CRON_PRESETS) assert.equal(preset.label, cronText(preset.cron))
})

test('a routine says how it starts, and saves only what fits that start', () => {
  assert.equal(START_LABELS.schedule, 'Schedule')
  assert.equal(START_LABELS.microsoftTeams, 'Microsoft Teams')
  assert.equal(startLine({ trigger: 'schedule', schedule: '0 9 * * 1-5', timeZone: 'Europe/Madrid' }), 'Every weekday at 9:00 AM · Europe/Madrid')
  assert.equal(startLine({ trigger: 'slack', schedule: '', event: 'Mentions in #support' }), 'On a Slack message · Mentions in #support')
  assert.equal(startLine({ trigger: 'email', schedule: '' }), 'On an email')
  assert.equal(startLine({ schedule: 'Mon 09:00' }), 'Mon 09:00', 'an older routine shows its schedule as it is')
  assert.equal(startLine({ schedule: '15 18 * * 1-5' }), 'Every weekday at 6:15 PM', 'an older routine whose schedule is cron reads in words too')
  assert.deepEqual(draftRoutines([
    { name: ' Sweep ', schedule: '0 9 * * 1-5', timeZone: 'Europe/Madrid', event: 'left over', trigger: 'schedule', description: '', enabled: true, lastRun: '2026-10-20T09:00:00.000Z' },
    { name: 'Mentions', schedule: '0 9 * * *', timeZone: 'Europe/Madrid', event: 'Mentions in #support', trigger: 'slack', enabled: false },
    { name: '', schedule: '0 9 * * *', trigger: 'schedule' },
  ]), [
    { name: 'Sweep', schedule: '0 9 * * 1-5', timeZone: 'Europe/Madrid', trigger: 'schedule', lastRun: '2026-10-20T09:00:00.000Z' },
    { name: 'Mentions', schedule: '', event: 'Mentions in #support', trigger: 'slack', enabled: false },
  ])
})

test('Profile edits skills and routines the way the Grok Bot Graph panel does', () => {
  const profile = source('../../src/components/BotProfile.tsx')
  for (const text of [
    'placeholder="New skill"', 'placeholder="What it does (optional)"', '+ Add skill', 'aria-label="Remove skill"',
    'Work this bot starts on its own, on a schedule or after an event.', 'placeholder="New routine"', 'placeholder="What it does and what it delivers (optional)"',
    'Keep the instructions in Grok Bot. Only the outline is saved here.', '>Starts<', '>Schedule<', 'Presets', '>Time zone<', 'Bot timezone',
    'Empty uses the bot timezone from Grok Bot settings.', '>Active<', 'Turn off for routines paused in Grok Bot.', '>Remove<', '>Done<', '+ Add routine',
  ]) assert.ok(profile.includes(text), text)
})
