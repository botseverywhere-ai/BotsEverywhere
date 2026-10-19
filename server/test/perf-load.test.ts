import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { isDirectoryBotFile, parseDirectoryMarkdown } from '../src/directory-entries.ts'
import { parseSeatMarkdown, type OrgDocument } from '../src/org-files.ts'
import { listCompanies } from '../../src/data/mock-company-index.ts'

const root = path.resolve(import.meta.dirname, '../..')

test('the directory index is card fields only and matches the markdown', () => {
  const index = JSON.parse(readFileSync(path.join(root, 'src/generated/directory-index.json'), 'utf8')) as Record<string, unknown>[]
  const bots = readdirSync(path.join(root, 'directory'))
    .filter((name) => isDirectoryBotFile(name))
    .map((name) => {
      const slug = name.replace(/\.md$/, '')
      const parsed = parseDirectoryMarkdown(slug, readFileSync(path.join(root, 'directory', name), 'utf8'))
      assert.equal(parsed.ok, true)
      if (!parsed.ok) throw new Error('unreachable')
      return parsed.bot
    })
  assert.equal(index.length, bots.length)
  assert.ok(index.length >= 130)
  const bySlug = new Map(bots.map((bot) => [bot.slug, bot]))
  for (const card of index) {
    assert.deepEqual(Object.keys(card).sort(), ['addToGrokBotUrl', 'category', 'core', 'name', 'slug', 'summary'])
    const bot = bySlug.get(String(card.slug))
    assert.ok(bot)
    assert.equal(card.name, bot?.name)
    assert.equal(card.category, bot?.category)
    assert.equal(card.summary, bot?.summary)
    assert.equal(card.core, bot?.core)
    assert.equal(card.addToGrokBotUrl, bot?.addToGrokBotUrl)
  }
  const loader = readFileSync(path.join(root, 'src/directory/load.ts'), 'utf8')
  assert.match(loader, /directory-index\.json/)
  assert.match(loader, /loadDirectoryBot/)
  assert.equal(loader.includes('eager'), false)
  const page = readFileSync(path.join(root, 'src/pages/DirectoryPage.tsx'), 'utf8')
  assert.match(page, /useMemo\(/)
  assert.match(page, /hay\.includes\(needle\)/)
})

test('sample orgs stay out of the homepage and load one folder at a time', () => {
  const cards = JSON.parse(readFileSync(path.join(root, 'src/generated/sample-cards.json'), 'utf8')) as { id: string; name: string; label: string }[]
  const ids = listCompanies().filter((company) => !company.org.ownerOrg).map((company) => company.org.id)
  assert.equal(cards.length, ids.length)
  assert.equal(cards.length, 10)
  for (const card of cards) {
    const org = JSON.parse(readFileSync(path.join(root, 'samples', card.id, 'org.json'), 'utf8')) as OrgDocument
    assert.equal(card.name, org.company.name)
    const seats = readdirSync(path.join(root, 'samples', card.id, 'seats')).filter((name) => name.endsWith('.md'))
    const parsed = seats.map((name) => {
      const slug = name.replace(/\.md$/, '')
      const seat = parseSeatMarkdown(slug, readFileSync(path.join(root, 'samples', card.id, 'seats', name), 'utf8'))
      assert.equal(seat.ok, true)
      if (!seat.ok) throw new Error('unreachable')
      return seat.seat
    })
    const active = parsed.filter((seat) => seat.status !== 'retired')
    const humans = active.filter((seat) => seat.type === 'human').length
    const bots = active.filter((seat) => seat.type === 'bot').length
    const humanWord = humans === 1 ? 'human' : 'humans'
    const botWord = bots === 1 ? 'bot' : 'bots'
    assert.equal(card.label, `${humans} ${humanWord} · ${bots} ${botWord}`)
  }
  const landing = readFileSync(path.join(root, 'src/pages/Landing.tsx'), 'utf8')
  const load = readFileSync(path.join(root, 'src/org/load.ts'), 'utf8')
  const samples = readFileSync(path.join(root, 'src/org/samples.ts'), 'utf8')
  const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  assert.match(landing, /sample-cards/)
  assert.match(landing, /loading="lazy"/)
  assert.equal(landing.includes('realisticSamples'), false)
  assert.equal(load.includes('samples/'), false)
  assert.match(samples, /import\.meta\.glob\('\.\.\/\.\.\/samples\/\*\/org\.json'/)
  assert.equal(samples.includes('eager'), false)
  assert.match(app, /lazy\(\(\) => import\('\.\/pages\/DocsPage'\)/)
  assert.match(app, /lazy\(\(\) => import\('\.\/pages\/DemoHome'\)/)
  assert.match(app, /lazy\(\(\) => import\('\.\/pages\/Workspace'\)/)
  assert.match(app, /import\('\.\/org\/samples'\)/)
})
