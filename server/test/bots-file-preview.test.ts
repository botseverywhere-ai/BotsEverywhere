import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { IMPORT_LOCKED, parseBotsFile } from '../src/bots-file.ts'
import { createExistingBot, createOrgFiles, importBotsFile, previewBotsFile, readOrgDir, setSeatManagers, startTemplateServer } from '../src/template-server.ts'

const link = (id: string) => `grokbot://app/v1/agent?id=${id}`

/** BotsEverywhere already holds the structure; the file, like Grok Bot's answer, puts everyone under You. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-preview-test-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const home = createOrgFiles(orgs, 'BotsEverywhere', 'You')
  const fresh = createOrgFiles(orgs, 'New organization', 'You')
  assert.ok(home.ok && fresh.ok)
  const add = (name: string, id: string, reportsTo = 'you') =>
    assert.ok(createExistingBot(join(orgs, home.slug), home.slug, { name, grokBotUrl: link(id), reportsTo, allowEmptyCard: true }).ok)
  add('Grok Bot', 'g1')
  add('Growth', 'gr1', 'grok-bot')
  add('Overheard', 'o1', 'growth')
  add('Inner Loop', 'i1', 'grok-bot')
  add('Outer Loop', 'ol1', 'grok-bot')
  add('Security', 's1')
  assert.ok(setSeatManagers(join(orgs, home.slug), home.slug, 'security', 'inner-loop', ['outer-loop']).ok)
  const file = JSON.stringify({ bots: [
    { name: 'Grok Bot', grokBotUrl: link('g1'), reportsTo: 'You' },
    { name: 'Growth', grokBotUrl: link('gr1'), reportsTo: 'You' },
    { name: 'Overheard', grokBotUrl: link('o1'), reportsTo: 'You' },
    { name: 'Inner Loop', grokBotUrl: link('i1'), reportsTo: 'Grok Bot' },
    { name: 'Outer Loop', grokBotUrl: link('ol1'), reportsTo: 'Grok Bot' },
    { name: 'Security', grokBotUrl: link('s1'), reportsTo: 'Grok Bot' },
    { name: 'Tradbot', grokBotUrl: link('t1'), reportsTo: 'Nobody' },
    { name: 'Helper', grokBotUrl: link('h1'), reportsTo: 'Tradbot' },
  ] })
  return { dir, orgs, slug: fresh.slug, file, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function seatsOf(orgs: string, slug: string) {
  const read = readOrgDir(join(orgs, slug), slug)
  assert.ok(read.ok)
  if (!read.ok) return []
  const title = (seatSlug: string) => read.bundle.seats.find((seat) => seat.slug === seatSlug)?.title ?? seatSlug
  return read.bundle.seats.filter((seat) => seat.kind === 'bot').map((seat) => ({
    name: seat.title,
    reportsTo: title(seat.reportsTo),
    alsoReportsTo: (seat.alsoReportsTo ?? []).map(title),
  }))
}

test('the bots file preview shows the managers the import will save, not the ones the file names, and writes nothing', () => {
  const { orgs, slug, file, done } = project()
  try {
    const parsed = parseBotsFile(file)
    assert.ok(parsed.ok)
    if (!parsed.ok) return
    const before = readdirSync(join(orgs, slug), { recursive: true }).sort()
    const preview = previewBotsFile(orgs, join(orgs, slug), slug, parsed.rows)
    assert.deepEqual(readdirSync(join(orgs, slug), { recursive: true }).sort(), before, 'a preview writes nothing')
    assert.deepEqual(preview.errors, [])
    const row = (name: string) => preview.rows.find((item) => item.name === name)
    assert.equal(row('Overheard')?.reportsTo, 'Growth', 'a greyed bot keeps the manager it has where it works, as the import saves it')
    assert.deepEqual(row('Overheard')?.worksIn, ['BotsEverywhere'])
    assert.equal(row('Growth')?.reportsTo, 'Grok Bot')
    assert.equal(row('Security')?.reportsTo, 'Inner Loop')
    assert.deepEqual(row('Security')?.alsoReportsTo, ['Outer Loop'], 'extra managers come from where it works too')
    assert.equal(row('Tradbot')?.reportsTo, 'You')
    assert.deepEqual(row('Tradbot')?.worksIn, [])
    assert.deepEqual(row('Tradbot')?.notes, ['Nobody is not a seat here; placed under You.'])
    assert.equal(row('Helper')?.reportsTo, 'Tradbot', 'a manager from the same file')
    assert.deepEqual(preview.rows.map((item) => item.name), ['Grok Bot', 'Growth', 'Overheard', 'Inner Loop', 'Outer Loop', 'Security', 'Tradbot', 'Helper'], 'in the order of the file')
    // The import itself then saves exactly what the preview showed.
    assert.deepEqual(importBotsFile(join(orgs, slug), slug, parsed.rows).errors, [])
    const saved = seatsOf(orgs, slug)
    for (const item of preview.rows) {
      assert.deepEqual(saved.find((seat) => seat.name === item.name), { name: item.name, reportsTo: item.reportsTo, alsoReportsTo: item.alsoReportsTo }, item.name)
    }
  } finally {
    done()
  }
})

test('POST /bots-file/preview answers with the plan and writes nothing; a locked organization answers 409', async () => {
  const { orgs, slug, file, done } = project()
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    const post = (path: string) => fetch(`http://127.0.0.1:${started.port}/api/orgs/${slug}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: file })
    const before = readdirSync(join(orgs, slug), { recursive: true }).sort()
    const answer = await post('bots-file/preview')
    assert.equal(answer.status, 200)
    const body = (await answer.json()) as { rows: { name: string; reportsTo: string; worksIn: string[] }[] }
    assert.equal(body.rows.find((item) => item.name === 'Overheard')?.reportsTo, 'Growth')
    assert.deepEqual(readdirSync(join(orgs, slug), { recursive: true }).sort(), before)
    assert.equal((await post('bots-file')).status, 200)
    const locked = await post('bots-file/preview')
    assert.equal(locked.status, 409)
    assert.equal(((await locked.json()) as { error?: string }).error, IMPORT_LOCKED)
  } finally {
    await started.close()
    done()
  }
})

test('the bots file preview on Connect bots comes from the writer; the Grok Bot file lists the bots without who reports to whom', () => {
  const page = readFileSync(new URL('../../src/components/BotsFileImport.tsx', import.meta.url), 'utf8')
  assert.match(page, /fetch\(`\/api\/orgs\/\$\{slug\}\/bots-file\/preview`/)
  assert.match(page, /const showManagers = mode === 'template'/, 'only Option 2, an organization the owner designed, shows managers')
  assert.match(page, /\{showManagers \? <span>reports to \{row\.reportsTo\}<\/span> : null\}/)
  assert.match(page, /\{showManagers && row\.alsoReportsTo\.length \? <span>also reports to \{row\.alsoReportsTo\.join\(', '\)\}<\/span> : null\}/)
  assert.equal((page.match(/reports to \{row\./g) ?? []).length, 2, 'no other line names a manager')
  assert.match(page, /\{showManagers && row\.worksIn\.length \? <span className="bots-note">Works in \{row\.worksIn\.join\(', '\)\}: it comes in greyed, under the managers it has there\.<\/span> : null\}/, 'Option 1 shows the names alone')
  assert.match(page, /\{showManagers \? \[fileNote\(row\.name\), \.\.\.row\.notes\]/)
  assert.match(page, /readySummary\(plan, fileNote, namesOnly\)/, 'no note count where no note is shown')
  assert.match(page, /Checking where each bot goes…/)
})
