import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GROK_DATA_FILE, TODO_FILE } from '../src/connector-files.ts'
import { ensureProjectId } from '../src/project.ts'
import { DELETED_DIR, createExistingBot, createOrgFiles, deleteOrg, listOrgSlugs, startTemplateServer } from '../src/template-server.ts'

test('deleting an organization needs its exact name, moves the folder aside, and can remove the last one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-delete-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const north = createOrgFiles(orgs, 'North office', 'Ada')
    assert.equal(north.ok, true)
    if (!north.ok) return

    const south = createOrgFiles(orgs, 'South office', 'Ada')
    assert.equal(south.ok, true)
    if (!south.ok) return
    const wrong = deleteOrg(orgs, north.slug, 'north office')
    assert.equal(!wrong.ok && wrong.status, 422, 'the name must match exactly')
    assert.equal(existsSync(join(orgs, north.slug)), true)

    const gone = deleteOrg(orgs, north.slug, ' North office ')
    assert.deepEqual(gone, { ok: true, next: south.slug })
    assert.equal(existsSync(join(orgs, north.slug)), false)
    assert.deepEqual(listOrgSlugs(orgs), [south.slug], 'a deleted org is not listed')
    const kept = readdirSync(join(orgs, DELETED_DIR))
    assert.equal(kept.length, 1)
    assert.ok(kept[0]!.startsWith(`${north.slug}-`))
    assert.equal(existsSync(join(orgs, DELETED_DIR, kept[0]!, 'org.md')), true, 'the files can be moved back')

    const last = deleteOrg(orgs, south.slug, 'South office')
    assert.deepEqual(last, { ok: true, next: '' }, 'the only organization can go too, with no next one to open')
    assert.deepEqual(listOrgSlugs(orgs), [], 'the copy starts from zero')
    assert.equal(readdirSync(join(orgs, DELETED_DIR)).length, 2, 'both can be moved back')

    assert.equal(!deleteOrg(orgs, 'missing-org', 'x').ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleting an organization rewrites the Connector\'s to-do list before it answers, so nothing is sent for it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-delete-todo-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const copy = ensureProjectId(orgs)
  const desk = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(desk.ok)
  if (!desk.ok) return
  assert.ok(createExistingBot(join(orgs, desk.slug), desk.slug, { name: 'Brand', grokBotUrl: 'grokbot://app/v1/agent?id=b1', reportsTo: 'you', allowEmptyCard: true }).ok)
  writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify({
    dumpedAt: '2026-11-02T21:32:31+01:00',
    copy,
    bots: [{ id: 'b1', name: 'Brand', grokBotUrl: 'grokbot://app/v1/agent?id=b1', description: 'Brand work.', routinesVisible: false }],
    self: { id: 'c1', name: `Connector - BotsEverywhere (${copy})`, grokBotUrl: 'grokbot://app/v1/agent?id=c1' },
    skills: [],
  }))
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  const todo = () => (JSON.parse(readFileSync(join(orgs, TODO_FILE), 'utf8')) as { items: { kind: string; bot: string }[] }).items
  try {
    assert.deepEqual(todo().map((item) => `${item.kind} ${item.bot}`), ['describe Brand'], 'the bot is due its block')
    const answer = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${desk.slug}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'Desk' }) })
    assert.equal(answer.status, 200)
    assert.deepEqual(todo(), [], 'no block for an organization that is gone, already when the page hears back')
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('after deleting the last organization the page opens Your orgs, like a fresh copy', () => {
  const menu = readFileSync(new URL('../../src/components/OrgMenu.tsx', import.meta.url), 'utf8')
  assert.match(menu, /window\.location\.hash = body\.next \? `#\/org\/\$\{body\.next\}\/overview` : '#\/orgs'/)
  assert.doesNotMatch(menu, /!body\.next/, 'an empty next is not an error')
})
