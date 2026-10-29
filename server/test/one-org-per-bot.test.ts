import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseBotsFile } from '../src/bots-file.ts'
import { createExistingBot, createOrgFiles, importBotsFile, startTemplateServer } from '../src/template-server.ts'

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

test('importing many bots skips one active in another organization, and its reports go under You', () => {
  const { dir, a, b, add, done } = project()
  try {
    assert.ok(add(a, 'Research', 'r1').ok)
    const file = parseBotsFile(JSON.stringify({ bots: [{ name: 'Research', grokBotUrl: link('r1') }, { name: 'Writer', grokBotUrl: link('w1'), reportsTo: 'Research' }] }))
    assert.ok(file.ok)
    if (!file.ok) return
    const result = importBotsFile(join(dir, b), b, file.rows)
    assert.deepEqual(result.imported.map((item) => item.name), ['Writer'])
    assert.deepEqual(result.errors, [{ name: 'Research', error: `${message('Research', 'BotsEverywhere')} If it is your main bot, add it with Add existing bot.` }])
    assert.deepEqual(result.notes, [{ name: 'Writer', note: 'Research is not a seat here; placed under You.' }])
    assert.match(readFileSync(join(dir, b, 'seats', 'writer.md'), 'utf8'), /^reportsTo: you$/m)
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
