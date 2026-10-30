import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseBotsFile } from '../src/bots-file.ts'
import { GROK_DATA_FILE } from '../src/connector-files.ts'
import { writeMainBot } from '../src/project.ts'
import { createExistingBot, createOrgFiles, importBotsFile, importFromConnector, readOrgDir, setSeatManagers, startTemplateServer } from '../src/template-server.ts'

const link = (id: string) => `grokbot://app/v1/agent?id=${id}`
const card = { owns: ['Briefs'], may: ['Read sources'], mustAskBefore: ['Publishing'], doneWhen: ['The brief is sent'] }
const message = (name: string, orgs: string) => `${name} is already in ${orgs}. A bot works for one organization. To use it here too, duplicate it in Grok Bot, rename the copy, and add the copy. To move it here, retire it there first.`

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-one-org-'))
  const a = createOrgFiles(dir, 'BotsEverywhere', 'You')
  const b = createOrgFiles(dir, 'Aurafarming', 'You')
  assert.ok(a.ok && b.ok)
  const add = (org: string, name: string, id: string, extra: Record<string, unknown> = {}) =>
    createExistingBot(join(dir, org), org, { name, grokBotUrl: link(id), reportsTo: 'you', allowEmptyCard: true, ...extra })
  return { dir, a: a.slug, b: b.slug, add, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('a bot active in another organization is refused by its Grok Bot id, and Add anyway lets it in', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Research', 'r1').ok)
    const refused = add(b, 'Research', 'r1')
    assert.equal(refused.ok, false)
    if (refused.ok) return
    assert.deepEqual(refused.errors, [message('Research', 'BotsEverywhere')])
    assert.deepEqual(refused.otherOrgs, ['BotsEverywhere'])
    assert.equal(existsSync(join(dir, b, 'seats', 'research.md')), false, 'nothing is written')
    assert.equal(add(b, 'Research - Aurafarming', 'r1').ok, false, 'a renamed bot is the same bot')
    const sameId = createExistingBot(join(dir, b), b, { name: 'Research', grokBotUrl: `${link('r1')}&from=share`, reportsTo: 'you', allowEmptyCard: true })
    assert.equal(sameId.ok, false, 'the id decides, not how the link is written')
    assert.ok(add(b, 'Research', 'r1', { allowOtherOrgs: true }).ok, 'Add anyway: the main bot belongs in every organization')
  } finally {
    done()
  }
})

test('a copy, a retired bot, a bot without a link, and the Connector are never refused', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Research', 'r1').ok)
    assert.ok(add(b, 'Research', 'r2').ok, 'a copy has its own id')
    assert.ok(add(a, 'Writer', 'w1').ok)
    const seat = join(dir, a, 'seats', 'writer.md')
    writeFileSync(seat, readFileSync(seat, 'utf8').replace(/^---\n/, '---\nstatus: retired\nretiredAt: "2026-10-29T10:00:00.000Z"\n'))
    assert.ok(add(b, 'Writer', 'w1').ok, 'retired there, so it can move here')
    assert.ok(createExistingBot(join(dir, a), a, { name: 'Notes', grokBotUrl: '', reportsTo: 'you', allowEmptyCard: true }).ok)
    assert.ok(createExistingBot(join(dir, b), b, { name: 'Notes', grokBotUrl: '', reportsTo: 'you', allowEmptyCard: true }).ok)
    assert.ok(add(a, 'Connector - BotsEverywhere (abcd)', 'c1').ok)
    assert.ok(add(b, 'Connector - BotsEverywhere (abcd)', 'c1').ok, 'one Connector serves every organization')
  } finally {
    done()
  }
})

test('importing brings a bot active elsewhere in greyed, and a bot naming it as manager waits under You', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Research', 'r1').ok)
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Research', grokBotUrl: link('r1') }, { name: 'Writer', grokBotUrl: link('w1'), reportsTo: 'Research' }] }))
    assert.ok(file.ok)
    if (!file.ok) return
    const result = importBotsFile(join(dir, b), b, file.rows)
    assert.deepEqual(result.imported.map((item) => item.name).sort(), ['Research', 'Writer'])
    assert.deepEqual(result.greyed, [{ name: 'Research', slug: 'research', orgs: ['BotsEverywhere'] }])
    assert.deepEqual(result.errors, [])
    const writer = readFileSync(join(dir, b, 'seats', 'writer.md'), 'utf8')
    assert.match(writer, /^reportsTo: you$/m)
    assert.match(writer, /^waitsFor: "?research"?$/m)
    const research = readFileSync(join(dir, b, 'seats', 'research.md'), 'utf8')
    assert.match(research, /^grokBotUrl: ""$/m)
    assert.match(research, /^elsewhereUrl: "grokbot:\/\/app\/v1\/agent\?id=r1"$/m)
  } finally {
    done()
  }
})

const managerOf = (dir: string, org: string, slug: string) => /^reportsTo: "?([^"\n]*)"?$/m.exec(readFileSync(join(dir, org, 'seats', `${slug}.md`), 'utf8'))?.[1]

test('importing from the Connector keeps the managers each bot has in the organization it works for', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Grok Bot', 'g1').ok)
    assert.ok(add(a, 'Brand', 'b1', { reportsTo: 'grok-bot' }).ok)
    assert.ok(add(a, 'Demo Video', 'd1', { reportsTo: 'brand' }).ok)
    // Their own text only names Grok Bot; the structure was set in BotsEverywhere.
    writeFileSync(join(dir, GROK_DATA_FILE), JSON.stringify({ dumpedAt: '2026-10-30T15:00:00+01:00', copy: 'acn8', bots: [
      { id: 'g1', name: 'Grok Bot', description: 'Routes work.', routinesVisible: false },
      { id: 'b1', name: 'Brand', description: 'Brand work.', routinesVisible: false, reportsTo: 'Grok Bot' },
      { id: 'd1', name: 'Demo Video', description: 'Demo work.', routinesVisible: false, reportsTo: 'Grok Bot' },
    ], skills: [] }))
    const result = importFromConnector(dir, join(dir, b), b)
    assert.ok(!('error' in result), JSON.stringify(result))
    if ('error' in result) return
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.greyed.map((item) => item.name).sort(), ['Brand', 'Demo Video', 'Grok Bot'])
    assert.equal(managerOf(dir, b, 'grok-bot'), 'you')
    assert.equal(managerOf(dir, b, 'brand'), 'grok-bot', 'a greyed bot may report to a greyed bot')
    assert.equal(managerOf(dir, b, 'demo-video'), 'brand', 'the manager it has where it works wins over its own text')
    assert.ok(readOrgDir(join(dir, b), b).ok, 'the organization reads back')
  } finally {
    done()
  }
})

test('importing keeps the extra managers a bot has in the organization it works for', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Inner Loop', 'i1').ok)
    assert.ok(add(a, 'Outer Loop', 'o1').ok)
    assert.ok(add(a, 'Security', 's1').ok)
    assert.ok(setSeatManagers(join(dir, a), a, 'security', 'inner-loop', ['outer-loop']).ok)
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Inner Loop', grokBotUrl: link('i1') }, { name: 'Outer Loop', grokBotUrl: link('o1') }, { name: 'Security', grokBotUrl: link('s1') }] }))
    assert.ok(file.ok)
    if (!file.ok) return
    assert.deepEqual(importBotsFile(join(dir, b), b, file.rows).errors, [])
    const security = readFileSync(join(dir, b, 'seats', 'security.md'), 'utf8')
    assert.match(security, /^reportsTo: "?inner-loop"?$/m)
    assert.match(security, /^alsoReportsTo: .*outer-loop/m)
  } finally {
    done()
  }
})

test('a bot whose manager where it works is not imported falls back to who its own text names', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Brand', 'b1').ok)
    assert.ok(add(a, 'Demo Video', 'd1', { reportsTo: 'brand' }).ok)
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Grok Bot', grokBotUrl: link('g1') }, { name: 'Demo Video', grokBotUrl: link('d1'), reportsTo: 'Grok Bot' }] }))
    assert.ok(file.ok)
    if (!file.ok) return
    assert.deepEqual(importBotsFile(join(dir, b), b, file.rows).errors, [])
    assert.equal(managerOf(dir, b, 'demo-video'), 'grok-bot')
  } finally {
    done()
  }
})

test('the main bot is never greyed or refused', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Grok Bot', 'main').ok)
    assert.ok(writeMainBot(dir, 'main').ok)
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Grok Bot', grokBotUrl: link('main') }] }))
    assert.ok(file.ok)
    if (!file.ok) return
    assert.deepEqual(importBotsFile(join(dir, b), b, file.rows).greyed, [])
    const other = createOrgFiles(dir, 'techiewithmiguel', 'You')
    assert.ok(other.ok)
    if (other.ok) assert.ok(add(other.slug, 'Grok Bot', 'main').ok, 'Add existing bot lets the main bot in too')
  } finally {
    done()
  }
})

test('a manager that is not in the file goes under You with a note', () => {
  const { dir, b, done } = project()
  try {
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Writer', grokBotUrl: link('w1'), reportsTo: 'Nobody' }] }))
    assert.ok(file.ok)
    if (!file.ok) return
    assert.deepEqual(importBotsFile(join(dir, b), b, file.rows).notes, [{ name: 'Writer', note: 'Nobody is not a seat here; placed under You.' }])
  } finally {
    done()
  }
})

test('POST /seats/existing answers 409 with the organizations, then adds the bot when asked to anyway', async () => {
  const { dir, a, b, add, done } = project()
  assert.ok(add(a, 'Grok Bot', 'main').ok)
  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  try {
    const post = (body: Record<string, unknown>) => fetch(`http://127.0.0.1:${started.port}/api/orgs/${b}/seats/existing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Grok Bot', grokBotUrl: link('main'), reportsTo: 'you', ...card, ...body }),
    })
    const refused = await post({})
    const refusedBody = await refused.json() as { errors?: string[]; otherOrgs?: string[] }
    assert.equal(refused.status, 409, JSON.stringify(refusedBody))
    assert.deepEqual(refusedBody.otherOrgs, ['BotsEverywhere'])
    assert.deepEqual(refusedBody.errors, [message('Grok Bot', 'BotsEverywhere')])
    const added = await post({ allowOtherOrgs: true })
    assert.equal(added.status, 201, JSON.stringify(await added.clone().json()))
    assert.equal(existsSync(join(dir, b, 'seats', 'grok-bot.md')), true)
  } finally {
    await started.close()
    done()
  }
})

test('Add existing bot warns with Add anyway and Cancel, and sends allowOtherOrgs only after Add anyway', () => {
  const drawer = readFileSync(new URL('../../src/components/ExistingBotDrawer.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(drawer, /Only your main bot belongs in every organization\./)
  assert.match(drawer, />Add anyway<\/Button>/)
  assert.match(drawer, />Cancel<\/Button>/)
  assert.match(drawer, /allowOtherOrgs: true/)
  assert.match(workspace, /otherOrgs: body\.otherOrgs/, 'the page hands the organizations back to the drawer')
})
