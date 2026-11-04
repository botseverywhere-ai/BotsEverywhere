import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createOrgFiles, startTemplateServer } from '../src/template-server.ts'

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (check()) return true
    await new Promise((done) => setTimeout(done, 100))
  }
  return check()
}

test('on a fresh clone with no orgs folder, the writer keeps one copy id and hears the Connector', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-fresh-clone-'))
  const orgs = join(dir, 'orgs')
  assert.equal(existsSync(orgs), false, 'a fresh clone has no orgs folder')
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    assert.ok(existsSync(join(orgs, 'project.json')), 'the copy id is saved at start')
    const id = (JSON.parse(readFileSync(join(orgs, 'project.json'), 'utf8')) as { id: string }).id
    assert.ok(readFileSync(join(orgs, 'CONNECTOR.md'), 'utf8').startsWith(`# BotsEverywhere Connector rules (copy ${id})`), 'CONNECTOR.md names the same copy')
    const made = createOrgFiles(orgs, 'Fresh', 'You')
    assert.ok(made.ok)
    writeFileSync(join(orgs, 'connector.json'), JSON.stringify({ syncedAt: new Date().toISOString(), syncMinutes: 15 }))
    const logDir = join(orgs, made.slug, 'log')
    const heard = await waitFor(() => existsSync(logDir) && readdirSync(logDir).some((name) => name.startsWith('connector-connected-')), 15_000)
    assert.ok(heard, 'the Connector run is logged as Connected without restarting the writer')
  } finally {
    await started.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
