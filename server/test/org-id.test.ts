import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { copyTemplateOrg, createOrgFiles, newOrgId, readOrgDir, readOrgProfile, startTemplateServer, uniqueOrgId } from '../src/template-server.ts'
import { FILE_ID_NOTE } from '../../src/components/file-guide-copy.ts'

const ORG_ID = /^org-[abcdefghjkmnpqrstuvwxyz23456789]{8}$/

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'be-orgid-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  return { orgs, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function nameIn(orgs: string, slug: string): string {
  const read = readOrgDir(join(orgs, slug), slug)
  assert.ok(read.ok)
  return readOrgProfile(join(orgs, slug), read.bundle.org, read.bundle.seats).name
}

test('an org id is org- and 8 letters or digits without look-alikes', () => {
  assert.match(newOrgId(), ORG_ID)
  assert.equal(newOrgId(() => 0), 'org-aaaaaaaa')
  assert.equal(newOrgId(() => 0.9999), 'org-99999999')
  for (let n = 0; n < 200; n += 1) assert.doesNotMatch(newOrgId().slice(4), /[01ilo]/)
})

test('an id another folder has is never handed out twice', () => {
  const { orgs, done } = project()
  try {
    mkdirSync(join(orgs, 'org-aaaaaaaa'))
    let calls = 0
    // The first id drawn is taken; the next one is free.
    const id = uniqueOrgId(orgs, () => (calls++ < 8 ? 0 : 0.5))
    assert.notEqual(id, 'org-aaaaaaaa')
    assert.match(id, ORG_ID)
  } finally {
    done()
  }
})

test('a new org gets an id folder, and its name stays exactly as typed in org.md', () => {
  const { orgs, done } = project()
  try {
    const names = ['North office', 'North office', 'CON', '../escape', 'Café Ñandú']
    const slugs = names.map((name) => {
      const made = createOrgFiles(orgs, name, 'Ada')
      assert.ok(made.ok, name)
      assert.match(made.slug, ORG_ID, name)
      return made.slug
    })
    assert.equal(new Set(slugs).size, slugs.length, 'two orgs with one name still get two folders')
    names.forEach((name, index) => assert.equal(nameIn(orgs, slugs[index]!), name))
    assert.deepEqual(readdirSync(orgs).sort(), [...slugs].sort(), 'no folder is made from a name')
    assert.equal(existsSync(resolve(orgs, '..', 'escape')), false)

    const copied = copyTemplateOrg(orgs, fileURLToPath(new URL('../../samples', import.meta.url)), 'harbor')
    assert.ok(copied.ok)
    assert.match(copied.slug, ORG_ID, 'a template copy gets an id too')
  } finally {
    done()
  }
})

test('saving a new name changes org.md only: the folder is the id and never moves', async () => {
  const { orgs, done } = project()
  const made = createOrgFiles(orgs, 'New organization', 'You')
  assert.ok(made.ok)
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  try {
    const read = readOrgDir(join(orgs, made.slug), made.slug)
    assert.ok(read.ok)
    const profile = readOrgProfile(join(orgs, made.slug), read.bundle.org, read.bundle.seats)
    const response = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${made.slug}/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...profile, name: 'Test Org' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(readdirSync(orgs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name), [made.slug])
    assert.equal(nameIn(orgs, made.slug), 'Test Org')
  } finally {
    await started.close()
    done()
  }
})

test('Your files shows the name beside the id folder, and says the id never changes', () => {
  assert.equal(FILE_ID_NOTE, "The folder name is this organization's ID. It never changes, so bots always find their files.")
  const overview = readFileSync(fileURLToPath(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url)), 'utf8')
  assert.match(overview, /<FileGuide slug=\{slug\} name=\{org\.company\.name\} \/>/)
  const guide = readFileSync(fileURLToPath(new URL('../../src/components/FileGuide.tsx', import.meta.url)), 'utf8')
  assert.match(guide, /\{FILE_ID_NOTE\}/)
  assert.match(guide, /\{name\}/)
})
