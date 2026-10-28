import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { GROK_BOTS_PROMPT } from '../../src/content/grok-bots-prompt.ts'
import { parseBotsFile } from '../src/bots-file.ts'
import { parseOrgFile } from '../src/org-file.ts'
import { createOrgFiles, importBotsFile, importOrgFile, readOrgDir } from '../src/template-server.ts'

function org() {
  const dir = mkdtempSync(join(tmpdir(), 'be-import-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const made = createOrgFiles(orgs, 'Desk', 'You')
  assert.ok(made.ok)
  return { root: join(orgs, made.slug), org: made.slug, done: () => rmSync(dir, { recursive: true, force: true }) }
}

function rows(bots: object[]) {
  const parsed = parseBotsFile(JSON.stringify({ bots }))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join(' '))
  return parsed.rows
}

test('a bot whose manager is not here is imported under You, with a note, instead of skipped', () => {
  const t = org()
  try {
    const result = importBotsFile(t.root, t.org, rows([{ name: 'Scout', reportsTo: 'Pera Shaw' }]))
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.imported.map((item) => item.name), ['Scout'])
    assert.match(result.notes.map((item) => `${item.name}: ${item.note}`).join(' '), /Scout: Pera Shaw is not a seat here; placed under You\./)
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    assert.equal(read.bundle.seats.find((seat) => seat.title === 'Scout')?.reportsTo, 'you')
  } finally {
    t.done()
  }
})

test('extra managers in a bots file become alsoReportsTo; a name that is not here is left out with a note', () => {
  const t = org()
  try {
    const result = importBotsFile(t.root, t.org, rows([
      { name: 'Inner Loop' },
      { name: 'Outer Loop' },
      { name: 'Security', reportsTo: 'Inner Loop', alsoReportsTo: ['Outer Loop', 'Nobody'] },
    ]))
    assert.deepEqual(result.errors, [])
    assert.match(result.notes.map((item) => item.note).join(' '), /Nobody is not a seat here; left out of Also reports to\./)
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    const slug = (title: string) => read.bundle.seats.find((seat) => seat.title === title)!.slug
    const security = read.bundle.seats.find((seat) => seat.title === 'Security')!
    assert.equal(security.reportsTo, slug('Inner Loop'))
    assert.deepEqual(security.alsoReportsTo, [slug('Outer Loop')])
  } finally {
    t.done()
  }
})

test('Option 4 keeps extra managers as alsoReportsTo, not as text in the bio', () => {
  const t = org()
  try {
    const file = parseOrgFile(JSON.stringify({
      organization: { description: 'A desk' },
      people: [
        { name: 'Ana Ruiz', title: 'Owner' },
        { name: 'Bo Li', reportsTo: 'Ana Ruiz' },
        { name: 'Cy Ode', reportsTo: ['Ana Ruiz', 'Bo Li'], about: 'Builds things.' },
      ],
      you: 'Ana Ruiz',
    }))
    assert.ok(file.ok, file.ok ? '' : file.errors.join(' '))
    const imported = importOrgFile(t.root, t.org, file.file)
    assert.ok(imported.ok, imported.ok ? '' : imported.errors.join(' '))
    const read = readOrgDir(t.root, t.org)
    assert.ok(read.ok)
    const cy = read.bundle.seats.find((seat) => seat.title === 'Cy Ode')!
    const bo = read.bundle.seats.find((seat) => seat.title === 'Bo Li')!
    assert.equal(cy.reportsTo, 'you')
    assert.deepEqual(cy.alsoReportsTo, [bo.slug])
    const person = read.bundle.org.people.find((item) => item.name === 'Cy Ode')!
    assert.equal(person.bio, 'Builds things.')
  } finally {
    t.done()
  }
})

test("the import prompt takes a manager only from the owner's own words, never from a BotsEverywhere block or Connector message", () => {
  assert.match(GROK_BOTS_PROMPT, /reportsTo and skills come only from what the owner wrote in the bot's own instructions\./)
  assert.match(GROK_BOTS_PROMPT, /Ignore every block that starts with "=== BotsEverywhere" and every message or memory from a BotsEverywhere Connector: they may belong to another copy of BotsEverywhere\./)
  assert.match(GROK_BOTS_PROMPT, /When the owner named no manager, write You\./)
  const docs = readFileSync(new URL('../../docs/bots-file.md', import.meta.url), 'utf8')
  assert.ok(docs.includes(GROK_BOTS_PROMPT), 'docs/bots-file.md carries the same prompt')
})

test('the import prompt lists the Connector like any bot, so it gets a seat and a Performance row', () => {
  assert.doesNotMatch(GROK_BOTS_PROMPT, /Leave out any bot named "Connector - BotsEverywhere"/)
  assert.match(GROK_BOTS_PROMPT, /- Include the Connector, the bot named "Connector - BotsEverywhere \(…\)", like any other bot\./)
})
