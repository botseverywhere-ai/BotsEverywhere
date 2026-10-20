import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GROK_ACTIVITY_PROCESS, shownBotMetrics } from '../src/bot-metrics.ts'
import { recordConnectorRun } from '../src/connector-log.ts'
import { SNAPSHOT_FORMAT } from '../src/connector-prompt.ts'
import { CONNECTOR_FILE } from '../src/project.ts'
import { readRunLogDir } from '../src/run-log-files.ts'
import { createOrgFiles } from '../src/template-server.ts'

const X = 'grokbot://x'
const AURA = 'grokbot://aura'

function seat(root: string, slug: string, title: string, link: string) {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nstatus: active\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\nretiredAt: ""\ndirectoryId: ""\ngrokBotUrl: "${link}"\n---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

const minute = (n: number) => new Date(Date.now() + n * 60_000)
const hhmm = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** One Connector run: the org snapshot, then connector.json, at a file time. */
function run(orgs: string, slug: string, at: Date, bots: object[]) {
  mkdirSync(join(orgs, slug, 'grok'), { recursive: true })
  const path = join(orgs, slug, 'grok', 'snapshot.json')
  writeFileSync(path, JSON.stringify({ syncedAt: at.toISOString(), bots, processes: [] }))
  utimesSync(path, at, at)
  const connector = join(orgs, CONNECTOR_FILE)
  writeFileSync(connector, JSON.stringify({ syncedAt: at.toISOString(), unassigned: [] }))
  utimesSync(connector, at, at)
}

test('the Connector briefs Performance: a bot that became active is one use, a routine that ran is one automated task', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-brief-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const made = createOrgFiles(orgs, 'Desk', 'Ada')
    if (!made.ok) throw new Error('no org')
    const root = join(orgs, made.slug)
    seat(root, 'x-com', 'x.com - botseverywhere', X)
    seat(root, 'aura', 'aura production', AURA)
    seat(root, 'inner', 'Inner Loop', 'grokbot://inner')
    const t0 = minute(-60)
    const x = (lastActive: Date) => ({ name: 'x.com - botseverywhere', grokBotUrl: X, lastActive: lastActive.toISOString() })
    const aura = (lastActive: Date, lastRun: Date) => ({ name: 'aura production', grokBotUrl: AURA, lastActive: lastActive.toISOString(), routines: [{ name: 'Aura health', schedule: '0 9 * * 1-5', lastRun: lastRun.toISOString() }] })
    const inner = (lastActive: Date) => ({ name: 'Inner Loop', grokBotUrl: 'grokbot://inner', lastActive: lastActive.toISOString() })

    run(orgs, made.slug, minute(-40), [x(t0), aura(t0, t0), inner(t0)])
    recordConnectorRun(orgs, 'Connector')
    assert.equal(readRunLogDir(root).lines.length, 0, 'the first report only sets the starting point: nothing is backfilled')

    const used = minute(-30)
    const ran = minute(-25)
    const chatted = minute(-28)
    // Inner Loop logged its own chat, so the Connector does not add a second line for it.
    mkdirSync(join(root, 'log'), { recursive: true })
    writeFileSync(join(root, 'log', `${day(chatted)}.md`), `# Run log ${day(chatted)}\n- ${hhmm(chatted)} | Inner Loop | chat | push commits | done | -`)
    run(orgs, made.slug, minute(-20), [x(used), aura(ran, ran), inner(chatted)])
    recordConnectorRun(orgs, 'Connector')

    const lines = readRunLogDir(root).lines
    const seen = lines.filter((line) => line.note === 'seen by the Connector')
    assert.deepEqual(seen.map((line) => [line.bot, line.process, line.status, line.time]), [
      ['x.com - botseverywhere', GROK_ACTIVITY_PROCESS, 'done', hhmm(used)],
      ['aura production', 'Aura health', 'done', hhmm(ran)],
    ], 'x.com became active: one use. Aura ran its routine: one task, and that activity is not also a use. Inner Loop logged itself.')
    assert.equal(lines.filter((line) => line.bot === 'Inner Loop').length, 1)
    assert.ok(readFileSync(join(root, 'log', `${day(chatted)}.md`), 'utf8').includes(`push commits | done | -\n- `), 'a log without a final line break still gets whole lines')

    run(orgs, made.slug, minute(-10), [x(used), aura(ran, ran), inner(chatted)])
    recordConnectorRun(orgs, 'Connector')
    assert.equal(readRunLogDir(root).lines.length, lines.length, 'nothing moved: nothing new')

    const metrics = (title: string) => shownBotMetrics({ title, slug: '', log: readRunLogDir(root).lines })
    assert.equal(metrics('x.com - botseverywhere').usage, 1)
    assert.equal(metrics('aura production').tasks, 1)
    assert.equal(metrics('aura production').usage, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('one chat logged as waiting and then done is one use', () => {
  const shown = shownBotMetrics({
    title: 'Inner Loop',
    slug: 'inner',
    log: [
      { date: day(minute(-30)), time: hhmm(minute(-30)), bot: 'Inner Loop', process: 'chat', status: 'waiting', step: 'push commits' },
      { date: day(minute(-25)), time: hhmm(minute(-25)), bot: 'Inner Loop', process: 'chat', status: 'done', step: 'push commits' },
      { date: day(minute(-20)), time: hhmm(minute(-20)), bot: 'Inner Loop', process: 'chat', status: 'done', step: 'list routines' },
    ],
  })
  assert.equal(shown.usage, 2)
})

test('the Connector reports last active and each last run on every run, so Performance can follow them', () => {
  assert.match(SNAPSHOT_FORMAT, /Report lastActive and each routine's lastRun on every run, as Grok Bot shows them\. BotsEverywhere counts uses and automated tasks from how they change\./)
})
