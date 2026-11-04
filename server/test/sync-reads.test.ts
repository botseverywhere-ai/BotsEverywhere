import assert from 'node:assert/strict'
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createOrgFiles, syncStatus } from '../src/template-server.ts'

function seat(root: string, slug: string, title: string, extra: string) {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\ndirectoryId: ""\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

test('one sync request reads each organization once, whatever asks about it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'be-sync-reads-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const desk = createOrgFiles(orgs, 'Desk', 'Ada')
    const ledger = createOrgFiles(orgs, 'Ledger', 'Ada')
    if (!desk.ok || !ledger.ok) throw new Error('no org')
    for (const slug of [desk.slug, ledger.slug]) {
      seat(join(orgs, slug), 'invoice-bot', 'Invoice Bot', 'status: active\ngrokBotUrl: "grokbot://invoice"\n')
      seat(join(orgs, slug), 'old-bot', 'Old Bot', 'status: retired\nretiredAt: "2026-10-20T10:00:00.000Z"\ngrokBotUrl: "grokbot://old"\n')
      mkdirSync(join(orgs, slug, 'grok'), { recursive: true })
      writeFileSync(join(orgs, slug, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-20T18:00:00Z', bots: [{ name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice' }], processes: [] }))
    }
    writeFileSync(join(orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-20T18:00:00Z', unassigned: [] }))

    const listed = new Map<string, number>()
    const readdir = fs.readdirSync
    t.mock.method(fs, 'readdirSync', (...args: Parameters<typeof fs.readdirSync>) => {
      const path = String(args[0]).replace(/\\/g, '/')
      if (path.endsWith('/seats')) listed.set(path, (listed.get(path) ?? 0) + 1)
      return (readdir as (...a: unknown[]) => unknown)(...args)
    })
    syncBuiltinESMExports()
    let read: ReturnType<typeof syncStatus>
    try {
      read = syncStatus(join(orgs, desk.slug), desk.slug, orgs)
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    }
    assert.ok(read.ok)
    assert.deepEqual([...listed.values()], [1, 1], 'each seats/ folder listed once')
    assert.equal(listed.size, 2, 'both organizations were read')
    // The answer is the same as before: the project count, the account, and where a retired bot still runs.
    assert.equal(read.status.project?.bots, 2)
    assert.equal(read.status.project?.account?.total, 2, 'Invoice Bot once, and the Connector')
    assert.deepEqual(read.status.retiredElsewhere, {})
    assert.equal(read.status.plan?.rows.length ? true : false, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
