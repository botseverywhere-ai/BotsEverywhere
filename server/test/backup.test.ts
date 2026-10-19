import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createOrgFiles, importOrgBackup, orgZip, readOrgDir, startTemplateServer } from '../src/template-server.ts'
import { unzipStore, zipStore } from '../src/zip-store.ts'

const PROCESS = `---
name: Invoice arrives
trigger: event
source: email
description: A supplier invoice lands in the inbox.
doneWhen: The invoice is matched.
---

## Steps

- you | Approve payment

## Notes

Kept in the backup.
`
const RUN_LOG = '# Run log 2026-10-18\n\n- 15:35 | Connector | Sync | Wrote snapshots | done | -\n'

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-backup-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  return { orgs, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function org(orgs: string, name: string): string {
  const made = createOrgFiles(orgs, name, 'Ada')
  if (!made.ok) throw new Error('no org')
  return made.slug
}

function names(zip: Buffer): string[] {
  return unzipStore(zip).map((entry) => entry.name).sort()
}

test('Export saves the whole organization: processes, daily run logs, and a note that says so; never grok/', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    mkdirSync(join(root, 'processes'), { recursive: true })
    writeFileSync(join(root, 'processes', 'invoice-arrives.md'), PROCESS)
    mkdirSync(join(root, 'log'), { recursive: true })
    writeFileSync(join(root, 'log', '2026-10-18.md'), RUN_LOG)
    mkdirSync(join(root, 'grok'), { recursive: true })
    writeFileSync(join(root, 'grok', 'snapshot.json'), '{"bots":[]}')
    const zipped = orgZip(root, desk)
    assert.equal(zipped.ok, true)
    if (!zipped.ok) return
    const list = names(zipped.body)
    assert.ok(list.includes('processes/invoice-arrives.md'))
    assert.ok(list.includes('log/2026-10-18.md'))
    assert.ok(list.includes('backup.json'))
    assert.ok(list.includes('org.md') && list.includes('work-chart.md') && list.some((name) => name.startsWith('seats/')))
    assert.equal(list.some((name) => name.startsWith('grok/')), false)
    const note = JSON.parse(unzipStore(zipped.body).find((entry) => entry.name === 'backup.json')!.data.toString('utf8')) as { includes: string[] }
    assert.deepEqual(note.includes.sort(), ['processes', 'runLogs'])
  } finally {
    p.done()
  }
})

test('Import of a full backup restores processes and run logs exactly, and leaves grok/ alone', () => {
  const p = project()
  try {
    const source = org(p.orgs, 'Desk')
    const sourceRoot = join(p.orgs, source)
    mkdirSync(join(sourceRoot, 'processes'), { recursive: true })
    writeFileSync(join(sourceRoot, 'processes', 'invoice-arrives.md'), PROCESS)
    mkdirSync(join(sourceRoot, 'log'), { recursive: true })
    writeFileSync(join(sourceRoot, 'log', '2026-10-18.md'), RUN_LOG)
    const zipped = orgZip(sourceRoot, source)
    assert.equal(zipped.ok, true)
    if (!zipped.ok) return
    const target = org(p.orgs, 'Target')
    const targetRoot = join(p.orgs, target)
    mkdirSync(join(targetRoot, 'processes'), { recursive: true })
    writeFileSync(join(targetRoot, 'processes', 'old-process.md'), PROCESS.replace('Invoice arrives', 'Old process'))
    mkdirSync(join(targetRoot, 'log'), { recursive: true })
    writeFileSync(join(targetRoot, 'log', '2026-01-01.md'), '# Run log 2026-01-01\n')
    mkdirSync(join(targetRoot, 'grok'), { recursive: true })
    writeFileSync(join(targetRoot, 'grok', 'requests.json'), '{"requests":[]}')
    const imported = importOrgBackup(targetRoot, target, zipped.body)
    assert.equal(imported.ok, true, imported.ok ? '' : imported.errors.join(' '))
    assert.deepEqual(readdirSync(join(targetRoot, 'processes')).sort(), ['invoice-arrives.md'], 'processes are exactly the backup')
    assert.equal(readFileSync(join(targetRoot, 'processes', 'invoice-arrives.md'), 'utf8'), PROCESS)
    const runLogs = readdirSync(join(targetRoot, 'log')).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    assert.deepEqual(runLogs, ['2026-10-18.md'], 'run logs are exactly the backup')
    assert.equal(readFileSync(join(targetRoot, 'log', '2026-10-18.md'), 'utf8'), RUN_LOG)
    assert.ok(existsSync(join(targetRoot, 'grok', 'requests.json')), 'grok/ is left alone')
  } finally {
    p.done()
  }
})

test('Import of an older zip without the note keeps the current processes and run logs', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    const full = orgZip(root, desk)
    assert.equal(full.ok, true)
    if (!full.ok) return
    const old = zipStore(unzipStore(full.body).filter((entry) => entry.name !== 'backup.json' && !entry.name.startsWith('processes/') && !/^log\/\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)))
    mkdirSync(join(root, 'processes'), { recursive: true })
    writeFileSync(join(root, 'processes', 'invoice-arrives.md'), PROCESS)
    mkdirSync(join(root, 'log'), { recursive: true })
    writeFileSync(join(root, 'log', '2026-10-18.md'), RUN_LOG)
    const imported = importOrgBackup(root, desk, old)
    assert.equal(imported.ok, true, imported.ok ? '' : imported.errors.join(' '))
    assert.ok(existsSync(join(root, 'processes', 'invoice-arrives.md')), 'processes kept')
    assert.equal(readFileSync(join(root, 'log', '2026-10-18.md'), 'utf8'), RUN_LOG, 'run log kept')
  } finally {
    p.done()
  }
})

test('a backup with a bad process file is refused before anything is replaced', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    const full = orgZip(root, desk)
    if (!full.ok) throw new Error('no zip')
    const bad = zipStore([...unzipStore(full.body), { name: 'processes/broken.md', data: Buffer.from('no frontmatter') }])
    const before = readFileSync(join(root, 'org.md'), 'utf8')
    const imported = importOrgBackup(root, desk, bad)
    assert.equal(imported.ok, false)
    assert.equal(readFileSync(join(root, 'org.md'), 'utf8'), before)
  } finally {
    p.done()
  }
})

test('Import folder (the JSON route) restores processes and run logs too', async () => {
  const p = project()
  const server = await startTemplateServer({ port: 0, orgsDir: p.orgs })
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    const read = readOrgDir(root, desk)
    if (!read.ok) throw new Error('no org')
    const body = {
      org: read.bundle.org,
      seats: read.bundle.seats,
      work: read.bundle.work,
      activity: [],
      processes: [{ slug: 'invoice-arrives', source: PROCESS }],
      runLogs: [{ name: '2026-10-18.md', source: RUN_LOG }],
    }
    const response = await fetch(`http://127.0.0.1:${server.port}/api/orgs/${desk}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(response.status, 200, await response.text())
    assert.equal(readFileSync(join(root, 'processes', 'invoice-arrives.md'), 'utf8'), PROCESS)
    assert.equal(readFileSync(join(root, 'log', '2026-10-18.md'), 'utf8'), RUN_LOG)
  } finally {
    await server.close()
    p.done()
  }
})
