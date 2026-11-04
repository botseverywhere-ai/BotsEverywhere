import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateBotSource, type CatalogBot } from './frontmatter.js'

export type { CatalogBot }

export function loadCatalog(dir: string): { ok: true; bots: CatalogBot[] } | { ok: false; errors: string[] } {
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
  } catch {
    return { ok: false, errors: [`Cannot read bots directory: ${dir}`] }
  }
  if (names.length === 0) return { ok: false, errors: [`No bot markdown files in ${dir}`] }
  const bots: CatalogBot[] = []
  const errors: string[] = []
  for (const name of names) {
    const slug = name.slice(0, -3)
    const source = readFileSync(join(dir, name), 'utf8')
    const result = validateBotSource(slug, source)
    if (!result.ok) errors.push(...result.errors)
    else bots.push(result.bot)
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, bots }
}
