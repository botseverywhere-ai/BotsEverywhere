import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDirectoryBotFile, parseDirectoryMarkdown, validateDirectoryCatalog, type DirectoryBot } from '../server/src/directory-entries.ts'

const dir = resolve('directory')
const names = readdirSync(dir).filter((name) => isDirectoryBotFile(name)).sort()
const errors: string[] = []
const bots: DirectoryBot[] = []
for (const name of names) {
  const slug = name.replace(/\.md$/, '')
  const parsed = parseDirectoryMarkdown(slug, readFileSync(resolve(dir, name), 'utf8'))
  if (!parsed.ok) errors.push(...parsed.errors)
  else bots.push(parsed.bot)
}
errors.push(...validateDirectoryCatalog(bots))
if (errors.length) {
  for (const error of errors) console.error(error)
  process.exit(1)
}
console.log(`directory: ${bots.length} bots`)
