import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { FileGuideRow } from '../src/file-guide.ts'
import { readFileGuide, startTemplateServer } from '../src/template-server.ts'
import { FILE_GROUPS, FILE_NAMES, FILE_WHAT, fileFact } from '../../src/components/file-guide-copy.ts'
import { lastRunShort } from '../../src/components/sync-copy.ts'

const OLD = new Date('2026-10-20T21:00:00.000Z')
const NEW = new Date('2026-10-21T12:56:00.000Z')

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-files-'))
  const orgs = join(dir, 'orgs')
  const org = join(orgs, 'desk')
  mkdirSync(org, { recursive: true })
  return { orgs, org, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function file(path: string, text: string, when = OLD) {
  writeFileSync(path, text)
  utimesSync(path, when, when)
}

test('the file guide names the real folder and what sits in each part of it', () => {
  const { orgs, org, done } = project()
  try {
    file(join(org, 'org.md'), '---\nname: Desk\n---\n')
    mkdirSync(join(org, 'seats'))
    file(join(org, 'seats', 'you.md'), 'x')
    file(join(org, 'seats', 'research-bot.md'), 'x')
    file(join(org, 'seats', 'notes.txt'), 'not a seat')
    mkdirSync(join(org, 'processes'))
    file(join(org, 'processes', 'daily-brief.md'), 'x')
    mkdirSync(join(org, 'log'))
    file(join(org, 'log', '2026-10-20.md'), '# Run log 2026-10-20\n')
    file(join(org, 'log', '2026-10-21.md'), '# Run log 2026-10-21\n', NEW)
    file(join(org, 'log', 'hire-research-bot.md'), '---\nid: hire\n---\n')
    mkdirSync(join(org, 'grok'))
    file(join(org, 'grok', 'snapshot.json'), '{}', NEW)
    file(join(orgs, 'connector.json'), '{}', NEW)

    const guide = readFileGuide(orgs, 'desk')
    assert.ok(guide)
    assert.equal(guide.folder, org)
    const row = (key: string) => guide.rows.find((item) => item.key === key)!
    assert.deepEqual(guide.rows.map((item) => item.key), ['org', 'seats', 'processes', 'log', 'grok', 'connector'])
    assert.deepEqual(row('org'), { key: 'org', path: join(org, 'org.md'), files: 1, updatedAt: OLD.toISOString() })
    assert.equal(row('seats').path, join(org, 'seats'))
    assert.equal(row('seats').files, 2, 'only .md files are seats')
    assert.equal(row('processes').files, 1)
    assert.equal(row('log').files, 3)
    assert.equal(row('log').days, 2, 'dated run logs count as days')
    assert.equal(row('log').updatedAt, NEW.toISOString(), 'the newest file says when the folder was last written')
    assert.equal(row('grok').updatedAt, NEW.toISOString())
    assert.deepEqual(row('connector'), { key: 'connector', path: join(orgs, 'connector.json'), files: 1, updatedAt: NEW.toISOString() })
  } finally {
    done()
  }
})

test('the file guide reports missing parts as empty and never throws', () => {
  const { orgs, org, done } = project()
  try {
    file(join(org, 'org.md'), '---\nname: Desk\n---\n')
    const guide = readFileGuide(orgs, 'desk')
    assert.ok(guide)
    for (const row of guide.rows.filter((item) => item.key !== 'org')) {
      assert.equal(row.files, 0, `${row.key} has no files`)
      assert.equal(row.updatedAt, '', `${row.key} was never written`)
    }
    assert.equal(readFileGuide(orgs, 'nobody'), null, 'an org that is not there')
    assert.equal(readFileGuide(orgs, '../desk'), null, 'a slug that leaves the orgs folder')
  } finally {
    done()
  }
})

test('GET /api/orgs/<slug>/files serves the guide, and 404 for an org that is not there', async () => {
  const { orgs, org, done } = project()
  file(join(org, 'org.md'), '---\nname: Desk\n---\n')
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/desk/files`)
    assert.equal(response.status, 200)
    const body = (await response.json()) as { folder: string; rows: { key: string }[] }
    assert.equal(body.folder, org)
    assert.equal(body.rows.length, 6)
    assert.equal((await fetch(`http://127.0.0.1:${started.port}/api/orgs/nobody/files`)).status, 404)
  } finally {
    await started.close()
    done()
  }
})

test('the file guide groups the files by who writes them, in plain words', () => {
  assert.deepEqual(FILE_GROUPS, [
    { title: 'Your organization', keys: ['org', 'seats', 'processes'] },
    { title: 'Your bots write these', keys: ['log'] },
    { title: 'The Connector writes these', keys: ['grok', 'connector'] },
  ])
  assert.deepEqual(FILE_NAMES, { org: 'org.md', seats: 'seats/', processes: 'processes/', log: 'log/', grok: 'grok/', connector: 'connector.json' })
  for (const key of Object.keys(FILE_NAMES) as (keyof typeof FILE_NAMES)[]) {
    assert.ok(FILE_WHAT[key].length > 0, `${key} says what it holds`)
    assert.doesNotMatch(FILE_WHAT[key], /\bcompan(y|ies)\b/i, 'organization, never company')
  }
})

test('each row says what is in it now', () => {
  const now = Date.parse('2026-10-21T13:30:00.000Z')
  const at = '2026-10-21T12:56:00.000Z'
  const time = lastRunShort(Date.parse(at), now)
  const row = (key: FileGuideRow['key'], files: number, updatedAt = '', days?: number): FileGuideRow => ({ key, path: '/x', files, updatedAt, ...(days === undefined ? {} : { days }) })
  assert.equal(fileFact(row('org', 1, at), now), `Saved ${time}`)
  assert.equal(fileFact(row('org', 0), now), 'Not there yet')
  assert.equal(fileFact(row('seats', 46, at), now), '46 files')
  assert.equal(fileFact(row('processes', 1, at), now), '1 file')
  assert.equal(fileFact(row('processes', 0), now), 'No files yet')
  assert.equal(fileFact(row('log', 173, at, 4), now), `4 days of run logs, 169 events · last written ${time}`)
  assert.equal(fileFact(row('log', 2, at, 1), now), `1 day of run logs, 1 event · last written ${time}`)
  assert.equal(fileFact(row('log', 0, '', 0), now), 'Nothing logged yet')
  assert.equal(fileFact(row('grok', 2, at), now), `Updated ${time}`)
  assert.equal(fileFact(row('grok', 0), now), 'Nothing yet')
  assert.equal(fileFact(row('connector', 1, at), now), `Last run ${time}`)
  assert.equal(fileFact(row('connector', 0), now), 'The Connector has not run yet')
})

test('Your files sits on the Overview of your own organizations, only tells, and stays current', () => {
  const overview = readFileSync(fileURLToPath(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url)), 'utf8')
  assert.match(overview, /section === 'overview' && editable \? <FileGuide slug=\{slug\} \/> : null/)
  const guide = readFileSync(fileURLToPath(new URL('../../src/components/FileGuide.tsx', import.meta.url)), 'utf8')
  assert.match(guide, /fetch\(`\/api\/orgs\/\$\{slug\}\/files`\)/)
  assert.match(guide, /new EventSource\(`\/api\/orgs\/\$\{slug\}\/live`\)/, 'a bot or the Connector writing refreshes it')
  assert.equal(guide.match(/<Button\b/g)?.length, 1, 'Copy path is the only button')
  assert.match(guide, /'Copy path'/)
  assert.doesNotMatch(guide, /method: '(POST|PUT|DELETE)'/, 'it never changes a file')
})
