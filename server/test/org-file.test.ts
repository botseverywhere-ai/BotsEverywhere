import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { importLocked } from '../src/bots-file.ts'
import { ORG_IMPORT_LOCKED, orgImportLocked, parseOrgFile } from '../src/org-file.ts'
import { ORG_FILE_PROMPT } from '../../src/content/org-file-prompt.ts'
import { createOrgFiles, importOrgFile, readOrgDir, readOrgProfile } from '../src/template-server.ts'

const sample = {
  organization: {
    name: 'Harbor Valuations',
    website: 'https://example.com',
    description: 'Business valuations for owners who sell or buy a company.',
    purpose: 'Give owners a fair, defensible value.',
    industry: 'Financial services',
    size: '5 people',
  },
  departments: ['Leadership', 'Financial analysis', 'Operations'],
  people: [
    { name: 'Ada Moreno', title: 'CEO', department: 'Leadership', owns: ['Sales calls', 'Lead supervision'] },
    { name: 'Ben Carter', title: 'Partner', department: 'Leadership' },
    { name: 'Chloé Park', title: 'Financial analyst', department: 'Financial analysis', reportsTo: ['Ada Moreno', 'Ben Carter'], owns: ['The financial report'] },
    { name: 'Dev Shah', title: 'Operations and accounting', department: 'Operations', reportsTo: ['Ada Moreno', 'Ben Carter'], email: 'dev@example.com' },
    { name: 'Eva Núñez', title: 'Software and digital marketing', department: 'Digital', reportsTo: 'Ada Moreno' },
  ],
  you: 'Eva Núñez',
}

function freshOrg(name = 'Harbor', owner = 'Eva') {
  const dir = mkdtempSync(join(tmpdir(), 'be-org-file-'))
  const created = createOrgFiles(dir, name, owner)
  assert.ok(created.ok)
  if (!created.ok) throw new Error('org not created')
  return { dir, slug: created.slug, root: join(dir, created.slug) }
}

test('an organization file reads people, several people at the top, and several managers with the main one first', () => {
  const parsed = parseOrgFile(JSON.stringify(sample))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  const { file } = parsed
  assert.equal(file.organization.description, 'Business valuations for owners who sell or buy a company.')
  assert.equal(file.organization.size, '5 people')
  assert.deepEqual(file.departments, ['Leadership', 'Financial analysis', 'Operations'])
  assert.equal(file.you, 'Eva Núñez')
  const byName = new Map(file.people.map((person) => [person.name, person]))
  assert.equal(byName.get('Ada Moreno')!.reportsTo, '', 'no manager: at the top')
  assert.equal(byName.get('Ben Carter')!.reportsTo, '', 'several people can be at the top')
  assert.equal(byName.get('Chloé Park')!.reportsTo, 'Ada Moreno', 'the first manager is the chart line')
  assert.deepEqual(byName.get('Chloé Park')!.alsoReportsTo, ['Ben Carter'])
  assert.deepEqual(byName.get('Ada Moreno')!.owns, ['Sales calls', 'Lead supervision'])
  assert.equal(byName.get('Dev Shah')!.email, 'dev@example.com')
  assert.ok(file.people.every((person) => !person.error && !person.note))
})

test('a manager not in the file, a person who reports to themself, and a loop put that person at the top with a note', () => {
  const parsed = parseOrgFile(JSON.stringify({ people: [
    { name: 'Ada', reportsTo: 'Nobody Here' },
    { name: 'Ben', reportsTo: 'Ben' },
    { name: 'Cy', reportsTo: 'Dee' },
    { name: 'Dee', reportsTo: 'Cy' },
  ] }))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  const [ada, ben, cy, dee] = parsed.file.people
  assert.equal(ada!.reportsTo, '')
  assert.match(ada!.note, /Nobody Here is not in this file/)
  assert.equal(ben!.reportsTo, '')
  assert.match(ben!.note, /cannot report to themself/)
  assert.equal([cy!.reportsTo, dee!.reportsTo].filter(Boolean).length, 1, 'a loop is broken once')
  assert.match(cy!.note + dee!.note, /loop/)
})

test('a person without a name or a second person with the same name is not imported', () => {
  const parsed = parseOrgFile(JSON.stringify({ people: [{ title: 'CEO' }, { name: 'Ada' }, { name: 'ada' }] }))
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  assert.equal(parsed.file.people[0]!.error, 'Name is required.')
  assert.equal(parsed.file.people[1]!.error, '')
  assert.match(parsed.file.people[2]!.error, /already in this file/)
})

test('an organization file from any AI reads with a byte-order mark, Windows line endings, or a reply with one json code block', () => {
  const text = JSON.stringify(sample, null, 2)
  assert.ok(parseOrgFile(`﻿${text.replace(/\n/g, '\r\n')}\r\n`).ok)
  assert.ok(parseOrgFile(`Here is your file.\n\n\`\`\`json\n${text}\n\`\`\`\n`).ok)
  const prose = parseOrgFile('Sorry, I cannot write that file.')
  assert.equal(prose.ok, false)
  const bots = parseOrgFile(JSON.stringify({ bots: [{ name: 'Invoice Bot' }] }))
  assert.equal(bots.ok, false, 'a bots file is not an organization file')
  if (!bots.ok) assert.match(bots.errors.join(' '), /people list/)
})

test('importing builds the structure on a fresh organization: departments, people, seats, chart, You, and the organization fields', () => {
  const { dir, slug, root } = freshOrg()
  try {
    const parsed = parseOrgFile(JSON.stringify(sample))
    assert.ok(parsed.ok)
    if (!parsed.ok) return
    const result = importOrgFile(root, slug, parsed.file)
    assert.ok(result.ok, result.ok ? '' : result.errors.join(' '))
    if (!result.ok) return
    assert.equal(result.imported.length, 5)
    const loaded = readOrgDir(root, slug)
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.errors.join(' '))
    if (!loaded.ok) return
    const seats = new Map(loaded.bundle.seats.map((seat) => [seat.slug, seat]))
    assert.deepEqual([...seats.keys()].sort(), ['ada-moreno', 'ben-carter', 'chloe-park', 'dev-shah', 'you'], 'accents become plain letters in file names')
    assert.equal(seats.get('ada-moreno')!.reportsTo, '')
    assert.equal(seats.get('ben-carter')!.reportsTo, '')
    assert.equal(seats.get('chloe-park')!.reportsTo, 'ada-moreno')
    assert.deepEqual(seats.get('chloe-park')!.alsoReportsTo, ['ben-carter'], 'the second manager is a dotted line')
    assert.equal(seats.get('chloe-park')!.kind, 'human')
    assert.equal(seats.get('chloe-park')!.role, 'Financial analyst')
    assert.equal(seats.get('chloe-park')!.department, 'financial-analysis')
    assert.deepEqual(seats.get('chloe-park')!.owns, ['The financial report'])
    const you = seats.get('you')!
    assert.equal(you.title, 'Eva Núñez', 'the person importing becomes You')
    assert.equal(you.role, 'Software and digital marketing')
    assert.equal(you.reportsTo, 'ada-moreno')
    assert.equal(you.department, 'digital', 'a department named only on a person is added')
    const org = loaded.bundle.org
    assert.deepEqual(org.departments.map((item) => item.id), ['general', 'leadership', 'financial-analysis', 'operations', 'digital'])
    const people = new Map(org.people.map((person) => [person.id, person]))
    assert.equal(people.get('person-you')!.name, 'Eva Núñez')
    assert.equal(people.get('person-chloe-park')!.title, 'Financial analyst')
    assert.equal(people.get('person-chloe-park')!.bio, undefined, 'extra managers are not written into the bio')
    assert.equal(people.get('person-dev-shah')!.email, 'dev@example.com')
    const profile = readOrgProfile(root, org, loaded.bundle.seats)
    assert.equal(profile.name, 'Harbor', 'the organization keeps the name it was created with')
    assert.equal(profile.description, 'Business valuations for owners who sell or buy a company.')
    assert.equal(profile.purpose, 'Give owners a fair, defensible value.')
    assert.equal(profile.industry, 'Financial services')
    assert.equal(profile.size, '5 people')
    assert.equal(profile.people, 5)
    assert.ok(loaded.bundle.activity.some((event) => /Imported the organization: 5 people/.test(event.summary)))
    assert.equal(importLocked(loaded.bundle.seats), false, 'people do not lock bot imports: Options 1 and 2 stay open')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('importing is off once the organization has seats besides You; the Connector seat does not count', () => {
  const you = { slug: 'you', kind: 'human' as const, title: 'Eva' }
  assert.equal(orgImportLocked([you]), false)
  assert.equal(orgImportLocked([you, { slug: 'connector-botseverywhere', kind: 'bot', title: 'Connector - BotsEverywhere' }]), false)
  assert.equal(orgImportLocked([you, { slug: 'ada', kind: 'human', title: 'Ada' }]), true)
  const { dir, slug, root } = freshOrg()
  try {
    const parsed = parseOrgFile(JSON.stringify(sample))
    assert.ok(parsed.ok)
    if (!parsed.ok) return
    assert.ok(importOrgFile(root, slug, parsed.file).ok)
    const again = importOrgFile(root, slug, parsed.file)
    assert.equal(again.ok, false)
    if (!again.ok) assert.deepEqual(again.errors, [ORG_IMPORT_LOCKED])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without a you, You keeps its seat at the top and the people sit beside it', () => {
  const { dir, slug, root } = freshOrg()
  try {
    const parsed = parseOrgFile(JSON.stringify({ people: [{ name: 'Ada Moreno', title: 'Founder' }, { name: 'Ben Carter', reportsTo: 'Ada Moreno' }], you: 'Nobody' }))
    assert.ok(parsed.ok)
    if (!parsed.ok) return
    assert.match(parsed.file.notes.join(' '), /Nobody is not in the people list/)
    const result = importOrgFile(root, slug, parsed.file)
    assert.ok(result.ok)
    const loaded = readOrgDir(root, slug)
    assert.ok(loaded.ok)
    if (!loaded.ok) return
    const you = loaded.bundle.seats.find((seat) => seat.slug === 'you')!
    assert.equal(you.title, 'Eva')
    assert.equal(you.reportsTo, '')
    assert.equal(loaded.bundle.seats.find((seat) => seat.slug === 'ben-carter')!.reportsTo, 'ada-moreno')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the prompt has blanks for what the owner knows, and asks only about gaps before it writes the file', () => {
  for (const blank of ['Organization name:', 'Website(s):', 'Social media:', 'Description:', 'People (name, job title, department, what they do, who they report to):', 'Which of these people am I:']) {
    assert.ok(ORG_FILE_PROMPT.includes(blank), blank)
  }
  assert.match(ORG_FILE_PROMPT, /Don't interview me from zero/)
  assert.match(ORG_FILE_PROMPT, /Don't write the file until I confirm/)
  assert.match(ORG_FILE_PROMPT, /several people can be at the top/i)
  assert.match(ORG_FILE_PROMPT, /the main one first/)
  assert.match(ORG_FILE_PROMPT, /Never invent people/)
  assert.match(ORG_FILE_PROMPT, /botseverywhere-organization\.json/)
})

test('the organization file template carries the whole prompt and imports clean', () => {
  const text = readFileSync(fileURLToPath(new URL('../../public/organization-file-template.json', import.meta.url)), 'utf8')
  const file = JSON.parse(text) as { readme: string[]; instructions: string[]; fields: Record<string, string> }
  assert.match(file.readme[0]!, /If you are an AI reading this file/)
  assert.deepEqual(file.instructions, ORG_FILE_PROMPT.split('\n'))
  for (const key of ['organization', 'departments', 'people', 'name', 'title', 'department', 'reportsTo', 'owns', 'email', 'phone', 'location', 'about', 'you']) {
    assert.ok(file.fields[key], `fields.${key}`)
  }
  const parsed = parseOrgFile(text)
  assert.ok(parsed.ok)
  if (!parsed.ok) return
  assert.ok(parsed.file.people.length > 0)
  assert.ok(parsed.file.people.every((person) => !person.error && !person.note))
  assert.ok(parsed.file.people.filter((person) => !person.reportsTo).length >= 2, 'the example shows several people at the top')
  assert.ok(parsed.file.people.some((person) => person.alsoReportsTo.length > 0), 'the example shows someone with two managers')
  const { dir, slug, root } = freshOrg()
  try {
    assert.ok(importOrgFile(root, slug, parsed.file).ok)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('for the demo, Option 4 is off Connect bots; its panel and the writer route stay for later', () => {
  const link = readFileSync(fileURLToPath(new URL('../../src/components/LinkCompany.tsx', import.meta.url)), 'utf8')
  assert.equal(link.includes('Import an existing organization'), false)
  assert.equal(link.includes('<OrgFileImport '), false)
  const panel = readFileSync(fileURLToPath(new URL('../../src/components/OrgFileImport.tsx', import.meta.url)), 'utf8')
  assert.match(panel, /prompt=\{ORG_FILE_PROMPT\}/)
  assert.match(panel, /href="\/organization-file-template\.json"/)
  assert.match(panel, /\/api\/orgs\/\$\{slug\}\/org-file/)
  assert.match(panel, /ORG_IMPORT_LOCKED/)
  const server = readFileSync(fileURLToPath(new URL('../src/template-server.ts', import.meta.url)), 'utf8')
  assert.match(server, /\\\/org-file\$/)
})

test('docs/organization-file.md keeps the prompt; the Docs page lists only the two ways Step 2 offers', () => {
  const docs = readFileSync(fileURLToPath(new URL('../../docs/organization-file.md', import.meta.url)), 'utf8')
  assert.ok(docs.includes(ORG_FILE_PROMPT), 'docs/organization-file.md carries the same prompt')
  const page = readFileSync(fileURLToPath(new URL('../../src/pages/DocsPage.tsx', import.meta.url)), 'utf8')
  assert.equal(page.includes('Option 3: Add your organization manually'), false)
  assert.equal(page.includes('Option 4: Import an existing organization'), false)
  assert.match(page, /two ways to fill an organization/)
})
