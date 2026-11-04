import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseOrgProfile, profileFromOrg, serializeOrgProfile } from '../src/org-files.ts'
import { copyTemplateOrg, createOrgFiles, readOrgDir, readOrgProfile } from '../src/template-server.ts'

test('org.md round-trips the company overview', () => {
  const source = serializeOrgProfile({
    name: 'Northwind',
    description: 'A short line',
    purpose: 'Ship the work.\nKeep the approve.',
    industry: 'Software',
    size: '11–50',
    people: 2,
    bots: 4,
  })
  const parsed = parseOrgProfile(source)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.profile.name, 'Northwind')
  assert.equal(parsed.profile.description, 'A short line')
  assert.match(parsed.profile.purpose, /Keep the approve/)
  assert.equal(parsed.profile.people, 2)
  assert.equal(parsed.profile.bots, 4)
  assert.equal(parseOrgProfile('nope').ok, false)
})

test('a new org writes org.md and a template copy lands in orgs/', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'be-orgs-'))
  const samples = path.resolve(import.meta.dirname, '../../samples')
  const created = createOrgFiles(dir, 'North office', 'Ada')
  assert.equal(created.ok, true)
  if (!created.ok) return
  const profile = parseOrgProfile(readFileSync(path.join(dir, created.slug, 'org.md'), 'utf8'))
  assert.equal(profile.ok, true)
  if (profile.ok) assert.equal(profile.profile.name, 'North office')
  const copied = copyTemplateOrg(dir, samples, 'harbor')
  assert.equal(copied.ok, true)
  if (!copied.ok) return
  const org = readOrgDir(path.join(dir, copied.slug), copied.slug)
  assert.equal(org.ok, true)
  if (!org.ok) return
  assert.equal(existsSync(path.join(dir, copied.slug, 'work-chart.md')), true)
  assert.equal(existsSync(path.join(dir, copied.slug, 'org.json')), false)
  const overview = readOrgProfile(path.join(dir, copied.slug), org.bundle.org, org.bundle.seats)
  assert.equal(overview.name, org.bundle.org.company.name)
  assert.equal(profileFromOrg(org.bundle.org, org.bundle.seats).name, org.bundle.org.company.name)
})
