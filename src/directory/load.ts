import index from '../generated/directory-index.json'
import { isDirectoryBotFile, parseDirectoryMarkdown, type DirectoryBot } from './parse.ts'

export interface DirectoryCard {
  slug: string
  name: string
  category: string
  summary: string
  core: boolean
  addToGrokBotUrl: string | null
}

/** Card fields only. Prompt bodies load in loadDirectoryBot. */
export const directoryIndex: DirectoryCard[] = index

const files = import.meta.glob('../../directory/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

export function loadDirectoryBot(slug: string): Promise<DirectoryBot | undefined> {
  const entry = Object.entries(files).find(([path]) => {
    const name = path.split('/').pop() ?? ''
    return isDirectoryBotFile(name) && name.replace(/\.md$/, '') === slug
  })
  if (!entry) return Promise.resolve(undefined)
  return entry[1]().then((source) => {
    const parsed = parseDirectoryMarkdown(slug, source)
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
    return parsed.bot
  })
}
