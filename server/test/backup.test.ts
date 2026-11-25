import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
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

function request(seat: string, seatFile: string) {
  return { seat, name: 'Code Review Bot', seatFile, prompt: 'Review pull requests.', requestedAt: '2026-10-21T12:00:00.000Z' }
}

function requestsIn(root: string): { seat: string; seatFile: string }[] {
  return (JSON.parse(readFileSync(join(root, 'grok', 'requests.json'), 'utf8')) as { requests: { seat: string; seatFile: string }[] }).requests
}

test('Export saves the whole organization: processes, daily run logs, waiting requests, and a note that says so; never the snapshot', () => {
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
    writeFileSync(join(root, 'grok', 'requests.json'), JSON.stringify({ requests: [request('you', join(root, 'seats', 'you.md'))] }))
    const zipped = orgZip(root, desk)
    assert.equal(zipped.ok, true)
    if (!zipped.ok) return
    const list = names(zipped.body)
    assert.ok(list.includes('processes/invoice-arrives.md'))
    assert.ok(list.includes('log/2026-10-18.md'))
    assert.ok(list.includes('backup.json'))
    assert.ok(list.includes('org.md') && list.includes('work-chart.md') && list.some((name) => name.startsWith('seats/')))
    assert.ok(list.includes('grok/requests.json'), 'bots waiting to be created travel with the backup')
    assert.equal(list.includes('grok/snapshot.json'), false, 'the Connector rewrites the snapshot every run')
    const note = JSON.parse(unzipStore(zipped.body).find((entry) => entry.name === 'backup.json')!.data.toString('utf8')) as { includes: string[] }
    assert.deepEqual(note.includes.sort(), ['processes', 'requests', 'runLogs'])
  } finally {
    p.done()
  }
})

test('Import of a full backup restores processes and run logs exactly, and leaves the snapshot alone', () => {
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
    writeFileSync(join(targetRoot, 'grok', 'snapshot.json'), '{"bots":[]}')
    const imported = importOrgBackup(targetRoot, target, zipped.body)
    assert.equal(imported.ok, true, imported.ok ? '' : imported.errors.join(' '))
    assert.deepEqual(readdirSync(join(targetRoot, 'processes')).sort(), ['invoice-arrives.md'], 'processes are exactly the backup')
    assert.equal(readFileSync(join(targetRoot, 'processes', 'invoice-arrives.md'), 'utf8'), PROCESS)
    const runLogs = readdirSync(join(targetRoot, 'log')).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    assert.deepEqual(runLogs, ['2026-10-18.md'], 'run logs are exactly the backup')
    assert.equal(readFileSync(join(targetRoot, 'log', '2026-10-18.md'), 'utf8'), RUN_LOG)
    assert.equal(readFileSync(join(targetRoot, 'grok', 'snapshot.json'), 'utf8'), '{"bots":[]}', 'the snapshot is left alone')
  } finally {
    p.done()
  }
})

test('Import restores waiting requests pointing at the seat files here, and drops requests for seats the backup lacks', () => {
  const p = project()
  try {
    const source = org(p.orgs, 'Desk')
    const sourceRoot = join(p.orgs, source)
    mkdirSync(join(sourceRoot, 'grok'), { recursive: true })
    // Made on another computer: its paths are not this one's.
    writeFileSync(join(sourceRoot, 'grok', 'requests.json'), JSON.stringify({ requests: [request('you', '/Users/other/orgs/desk/seats/you.md'), request('gone-bot', '/Users/other/orgs/desk/seats/gone-bot.md')] }))
    const zipped = orgZip(sourceRoot, source)
    assert.ok(zipped.ok)
    const target = org(p.orgs, 'Target')
    const targetRoot = join(p.orgs, target)
    const imported = importOrgBackup(targetRoot, target, zipped.body)
    assert.equal(imported.ok, true, imported.ok ? '' : imported.errors.join(' '))
    assert.deepEqual(requestsIn(targetRoot), [{ ...request('you', join(targetRoot, 'seats', 'you.md')) }])
    assert.ok(imported.ok && imported.files.includes(`orgs/${target}/grok/requests.json`))
  } finally {
    p.done()
  }
})

test('Import of a backup with no waiting requests clears them, and an older backup keeps them', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    const full = orgZip(root, desk)
    assert.ok(full.ok)
    mkdirSync(join(root, 'grok'), { recursive: true })
    writeFileSync(join(root, 'grok', 'requests.json'), JSON.stringify({ requests: [request('you', join(root, 'seats', 'you.md'))] }))
    const older = zipStore(unzipStore(full.body).filter((entry) => entry.name !== 'backup.json'))
    assert.ok(importOrgBackup(root, desk, older).ok)
    assert.equal(requestsIn(root).length, 1, 'a backup from before requests were saved keeps the ones here')
    assert.ok(importOrgBackup(root, desk, full.body).ok)
    assert.deepEqual(requestsIn(root), [], 'a backup that had none waiting restores none')
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
      requests: [request('you', '/Users/other/orgs/desk/seats/you.md')],
    }
    const response = await fetch(`http://127.0.0.1:${server.port}/api/orgs/${desk}/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(response.status, 200, await response.text())
    assert.equal(readFileSync(join(root, 'processes', 'invoice-arrives.md'), 'utf8'), PROCESS)
    assert.equal(readFileSync(join(root, 'log', '2026-10-18.md'), 'utf8'), RUN_LOG)
    assert.deepEqual(requestsIn(root), [request('you', join(root, 'seats', 'you.md'))], 'Import folder restores waiting requests too')
  } finally {
    await server.close()
    p.done()
  }
})

const EVENT = `---
id: "later-edit"
type: edit
actorSeatId: "you"
actorType: human
timestamp: "2026-10-19T09:00:00.000Z"
---

Changed the card after the backup.
`

function logFiles(dir: string): [string, string][] {
  return readdirSync(dir)
    .sort()
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')])
}

/** A zip with one packed (deflated) file, which zipStore never writes. Every name in its directory points at that same packed data. */
function packedZip(names: string[], data: Buffer): Buffer {
  const packed = deflateRawSync(data)
  const first = Buffer.from(names[0]!)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(packed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(first.length, 26)
  const central: Buffer[] = []
  for (const text of names) {
    const name = Buffer.from(text)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(packed.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(0, 42)
    central.push(cen, name)
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(30 + first.length + packed.length, 16)
  return Buffer.concat([local, first, packed, centralBuf, end])
}

/** An organization with a backup, then an event and a run log the backup does not hold: what a refused Import must leave alone. */
function orgWithLaterLog(orgs: string) {
  const desk = org(orgs, 'Desk')
  const root = join(orgs, desk)
  const logDir = join(root, 'log')
  mkdirSync(logDir, { recursive: true })
  writeFileSync(join(logDir, '2026-10-18.md'), RUN_LOG)
  const full = orgZip(root, desk)
  if (!full.ok) throw new Error('no zip')
  writeFileSync(join(logDir, 'later-edit.md'), EVENT)
  writeFileSync(join(logDir, '2026-10-19.md'), RUN_LOG.replace('2026-10-18', '2026-10-19'))
  return { desk, root, logDir, backup: full.body }
}

test('Import refused because a seat file here is damaged leaves the log as it was', () => {
  const p = project()
  try {
    const o = orgWithLaterLog(p.orgs)
    // A seat made after the backup whose file got damaged: each file in the backup is fine, and the organization as a whole cannot be saved.
    writeFileSync(join(o.root, 'seats', 'broken.md'), 'no frontmatter')
    const before = logFiles(o.logDir)
    const imported = importOrgBackup(o.root, o.desk, o.backup)
    assert.equal(imported.ok, false)
    if (imported.ok) return
    assert.match(imported.errors.join(' '), /broken\.md: seat files are kept/)
    assert.deepEqual(logFiles(o.logDir), before)
  } finally {
    p.done()
  }
})

test('Import of a backup with a seat that reports to nobody known is refused and leaves the log as it was', () => {
  const p = project()
  try {
    const o = orgWithLaterLog(p.orgs)
    const entries = unzipStore(o.backup)
    const seat = entries.find((entry) => entry.name.startsWith('seats/'))
    if (!seat) throw new Error('no seat in the backup')
    const helper = seat.data.toString('utf8').replace(/^reportsTo:.*$/m, 'reportsTo: nobody')
    assert.match(helper, /^reportsTo: nobody$/m)
    const bad = zipStore([...entries, { name: 'seats/helper.md', data: Buffer.from(helper) }])
    const before = logFiles(o.logDir)
    const imported = importOrgBackup(o.root, o.desk, bad)
    assert.equal(imported.ok, false)
    if (imported.ok) return
    assert.match(imported.errors.join(' '), /helper reports to missing seat nobody/)
    assert.deepEqual(logFiles(o.logDir), before)
  } finally {
    p.done()
  }
})

test('a zip with more files than the limit is refused', () => {
  const three = zipStore(['a.md', 'b.md', 'c.md'].map((name) => ({ name, data: Buffer.from('x') })))
  assert.throws(() => unzipStore(three, { entries: 2, bytes: 1000 }), /too many files/)
  assert.equal(unzipStore(three, { entries: 3, bytes: 1000 }).length, 3)
})

test('a zip that unpacks past the limit is refused, stored or packed', () => {
  const stored = zipStore([
    { name: 'a.md', data: Buffer.alloc(600, 'a') },
    { name: 'b.md', data: Buffer.alloc(600, 'b') },
  ])
  assert.throws(() => unzipStore(stored, { entries: 10, bytes: 1000 }), /too large/)
  assert.equal(unzipStore(stored, { entries: 10, bytes: 1200 }).length, 2)
  const packed = packedZip(['a.md'], Buffer.alloc(5000))
  assert.ok(packed.length < 200, 'five thousand zeros pack into a few bytes')
  assert.throws(() => unzipStore(packed, { entries: 10, bytes: 1000 }), /too large/)
  assert.equal(unzipStore(packed, { entries: 10, bytes: 5000 })[0]!.data.length, 5000)
})

test('names that share the same packed data count every time', () => {
  const shared = packedZip(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], Buffer.alloc(1000))
  assert.throws(() => unzipStore(shared, { entries: 10, bytes: 3000 }), /too large/)
  assert.equal(unzipStore(shared, { entries: 10, bytes: 5000 }).length, 5)
})

test('Import refuses a small zip that unpacks to far more than a backup holds, and changes nothing', () => {
  const p = project()
  try {
    const desk = org(p.orgs, 'Desk')
    const root = join(p.orgs, desk)
    const small = packedZip(['seats/big.md'], Buffer.alloc(60 * 1024 * 1024))
    assert.ok(small.length < 100_000, 'small enough for the writer to take')
    const before = readFileSync(join(root, 'org.md'), 'utf8')
    const imported = importOrgBackup(root, desk, small)
    assert.equal(imported.ok, false)
    if (imported.ok) return
    assert.equal(imported.status, 422)
    assert.match(imported.errors.join(' '), /too large/)
    assert.equal(readFileSync(join(root, 'org.md'), 'utf8'), before)
  } finally {
    p.done()
  }
})
