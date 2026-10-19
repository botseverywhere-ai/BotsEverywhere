import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isDirectoryBotFile, parseDirectoryMarkdown, validateDirectoryCatalog } from '../server/src/directory-entries.ts'
import { parseSeatMarkdown, type OrgDocument } from '../server/src/org-files.ts'
import { listCompanies } from '../src/data/mock-company-index.ts'

const root = path.resolve(import.meta.dirname, '..')
const outDir = path.join(root, 'src/generated')

function humanBotLabel(seats: { type: string; status?: string }[]) {
  const active = seats.filter((seat) => seat.status !== 'retired')
  const humans = active.filter((seat) => seat.type === 'human').length
  const bots = active.filter((seat) => seat.type === 'bot').length
  const humanWord = humans === 1 ? 'human' : 'humans'
  const botWord = bots === 1 ? 'bot' : 'bots'
  return { humans, bots, label: `${humans} ${humanWord} · ${bots} ${botWord}` }
}

function writeDirectoryIndex() {
  const dir = path.join(root, 'directory')
  const bots = readdirSync(dir)
    .filter((name) => isDirectoryBotFile(name))
    .map((name) => {
      const slug = name.replace(/\.md$/, '')
      const parsed = parseDirectoryMarkdown(slug, readFileSync(path.join(dir, name), 'utf8'))
      if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
      return parsed.bot
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  const errors = validateDirectoryCatalog(bots)
  if (errors.length) throw new Error(errors.join('\n'))
  const cards = bots.map((bot) => ({
    slug: bot.slug,
    name: bot.name,
    category: bot.category,
    summary: bot.summary,
    core: bot.core,
    addToGrokBotUrl: bot.addToGrokBotUrl,
  }))
  writeFileSync(path.join(outDir, 'directory-index.json'), `${JSON.stringify(cards, null, 2)}\n`)
  return cards.length
}

function writeSampleCards() {
  const ids = listCompanies().filter((company) => !company.org.ownerOrg).map((company) => company.org.id)
  const cards = ids.map((id) => {
    const org = JSON.parse(readFileSync(path.join(root, 'samples', id, 'org.json'), 'utf8')) as OrgDocument
    const seatDir = path.join(root, 'samples', id, 'seats')
    const seats = readdirSync(seatDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => {
        const slug = name.replace(/\.md$/, '')
        const parsed = parseSeatMarkdown(slug, readFileSync(path.join(seatDir, name), 'utf8'))
        if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
        return parsed.seat
      })
    const counts = humanBotLabel(seats)
    return {
      id,
      name: org.company.name,
      industry: org.company.industry ?? '',
      tagline: org.company.tagline ?? '',
      mark: org.company.mark ?? '',
      humans: counts.humans,
      bots: counts.bots,
      label: counts.label,
    }
  })
  cards.sort((a, b) => a.name.localeCompare(b.name))
  writeFileSync(path.join(outDir, 'sample-cards.json'), `${JSON.stringify(cards, null, 2)}\n`)
  return cards.length
}

mkdirSync(outDir, { recursive: true })
const bots = writeDirectoryIndex()
const samples = writeSampleCards()
console.log(`directory index: ${bots} bots; sample cards: ${samples}`)
