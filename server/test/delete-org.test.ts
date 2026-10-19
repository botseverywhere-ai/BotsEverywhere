import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DELETED_DIR, createOrgFiles, deleteOrg, listOrgSlugs } from '../src/template-server.ts'

test('deleting an organization needs its exact name, keeps the last one, and moves the folder aside', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-delete-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const north = createOrgFiles(orgs, 'North office', 'Ada')
    assert.equal(north.ok, true)
    if (!north.ok) return
    const alone = deleteOrg(orgs, north.slug, 'North office')
    assert.equal(alone.ok, false, 'the only organization stays')
    assert.equal(!alone.ok && alone.status, 409)

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

    assert.equal(!deleteOrg(orgs, 'missing-org', 'x').ok, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
