import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { nextFreePort, portFromListenLine, writerOrigin } from '../../scripts/dev-ports.ts'
import { saveNotice } from '../../src/components/save-notice.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOrgFiles, startTemplateServer } from '../src/template-server.ts'

test('save alert names success and the failure reason', () => {
  assert.deepEqual(saveNotice(true, 'Org saved'), { kind: 'ok', message: 'Org saved' })
  assert.deepEqual(saveNotice(false, 'the writer is down'), { kind: 'bad', message: 'Not saved: the writer is down' })
  assert.deepEqual(saveNotice(false, 'Not saved: already marked'), { kind: 'bad', message: 'Not saved: already marked' })
  assert.deepEqual(saveNotice(true, 'Org imported'), { kind: 'ok', message: 'Org imported' })
  assert.deepEqual(saveNotice(false, 'disk is full', 'Not imported'), { kind: 'bad', message: 'Not imported: disk is full' })
})

test('next free port skips a port that is already taken', async () => {
  const blocker = createServer()
  const taken = await new Promise<number>((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(0, '127.0.0.1', () => {
      const address = blocker.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  try {
    const next = await nextFreePort(taken)
    assert.notEqual(next, taken)
    assert.ok(next > taken)
    const same = await nextFreePort(next)
    assert.equal(same, next)
  } finally {
    await new Promise((resolve) => blocker.close(() => resolve(undefined)))
  }
})

test('listen line and writer origin use the port that was actually bound', () => {
  assert.equal(portFromListenLine('Template file API listening on http://127.0.0.1:8788'), 8788)
  assert.equal(portFromListenLine('ready'), null)
  assert.equal(writerOrigin({ WRITER_PORT: '8800' }), 'http://127.0.0.1:8800')
  assert.equal(writerOrigin({}), 'http://127.0.0.1:8787')
})

test('the writer moves to the next port when its port is taken', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-port-'))
  const created = createOrgFiles(dir, 'Port Co', 'Ada')
  assert.equal(created.ok, true)
  const blocker = createServer()
  const taken = await new Promise<number>((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(0, '127.0.0.1', () => {
      const address = blocker.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  const lines: string[] = []
  const original = console.info
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  try {
    const started = await startTemplateServer({ port: taken, orgsDir: dir, host: '127.0.0.1' })
    assert.notEqual(started.port, taken)
    assert.ok(started.port > taken)
    const printed = lines.map(portFromListenLine).find((port) => port !== null)
    assert.equal(printed, started.port)
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs`)
    assert.equal(response.status, 200)
    await started.close()
  } finally {
    console.info = original
    await new Promise((resolve) => blocker.close(() => resolve(undefined)))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('overview, seat cards, and hire use the save alert', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const overview = readFileSync(join(root, 'src/pages/CompanyOverview.tsx'), 'utf8')
  const workspace = readFileSync(join(root, 'src/pages/Workspace.tsx'), 'utf8')
  const drawer = readFileSync(join(root, 'src/components/SeatDrawer.tsx'), 'utf8')
  const hire = readFileSync(join(root, 'src/components/HireDrawer.tsx'), 'utf8')
  const starter = readFileSync(join(root, 'orgs/your-company/org.md'), 'utf8')
  const files = readFileSync(join(root, 'src/components/OrgFiles.tsx'), 'utf8')
  const docs = readFileSync(join(root, 'src/pages/DocsPage.tsx'), 'utf8')
  assert.match(overview, /saveNotice\(true, 'Org saved'\)/)
  assert.match(overview, /<SaveAlert/)
  assert.match(overview, /Your organization name/)
  assert.match(overview, /What your organization does/)
  assert.match(workspace, /<SaveAlert kind="ok">/)
  assert.match(workspace, /was hired/)
  assert.match(workspace, /saveNotice\(false/)
  assert.match(drawer, /<SaveAlert/)
  assert.match(hire, /saveNotice\(false, hireError\)/)
  assert.doesNotMatch(workspace, /Unsaved edits from this browser/)
  assert.doesNotMatch(starter, /You own the approve/)
  assert.doesNotMatch(starter, /Your team/)
  assert.match(overview, /Backup/)
  assert.match(overview, /<OrgFiles slug=\{slug\}/)
  assert.match(files, /\/api\/orgs\/\$\{slug\}\/import/)
  assert.match(files, /Org imported/)
  assert.match(files, /'Not imported'/)
  assert.doesNotMatch(files, /DEFAULT_ORG_SLUG/)
  assert.doesNotMatch(files, /window\.location\.reload/)
  assert.doesNotMatch(docs, /<OrgFiles/)
  assert.match(docs, /Organization Overview/)
})
