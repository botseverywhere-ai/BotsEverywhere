import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DELETED_DIR, createOrgFiles, deleteOrg, listOrgSlugs } from '../src/template-server.ts'

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

test('after deleting the last organization the page opens Your orgs, like a fresh copy', () => {
  const menu = readFileSync(new URL('../../src/components/OrgMenu.tsx', import.meta.url), 'utf8')
  assert.match(menu, /window\.location\.hash = body\.next \? `#\/org\/\$\{body\.next\}\/overview` : '#\/orgs'/)
  assert.doesNotMatch(menu, /!body\.next/, 'an empty next is not an error')
})
