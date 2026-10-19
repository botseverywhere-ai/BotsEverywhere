export interface CatalogBot {
  slug: string
  name: string
  category: string
  integrations: string[]
  contributor: string
  addedAt: string
  grokShareUrl?: string
  summary: string
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

type FrontValue = string | string[]

export function parseFrontmatter(source: string): { data: Record<string, FrontValue>; body: string } | { error: string } {
  const text = source.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { error: 'Missing opening frontmatter marker.' }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const close = rest.search(/\r?\n---\r?\n/)
  if (close === -1) return { error: 'Missing closing frontmatter marker.' }
  const raw = rest.slice(0, close)
  const after = rest.slice(close).replace(/^\r?\n---\r?\n/, '')
  const data: Record<string, FrontValue> = {}
  let listKey: string | null = null
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    if (line.trim() === '') continue
    const item = /^ {2}- (.*)$/.exec(line)
    if (item) {
      if (!listKey) return { error: `List item without a key: ${line}` }
      const current = data[listKey]
      const values = Array.isArray(current) ? current : []
      values.push(unquote(item[1] ?? ''))
      data[listKey] = values
      continue
    }
    const field = /^([a-z0-9_]+):\s*(.*)$/.exec(line)
    if (!field) return { error: `Cannot read frontmatter line: ${line}` }
    const key = field[1] ?? ''
    const value = field[2] ?? ''
    if (value === '') {
      listKey = key
      data[key] = []
      continue
    }
    listKey = null
    data[key] = unquote(value)
  }
  return { data, body: after.trim() }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.includes('.')
  } catch {
    return false
  }
}

export function validateBotSource(slug: string, source: string): { ok: true; bot: CatalogBot } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!SLUG.test(slug)) errors.push(`${slug}: filename must be a lowercase slug.`)
  const parsed = parseFrontmatter(source)
  if ('error' in parsed) return { ok: false, errors: [`${slug}.md: ${parsed.error}`] }
  const { data, body } = parsed
  const name = scalar(data.name)
  const category = scalar(data.category)
  const contributor = scalar(data.contributor)
  const addedAt = scalar(data.added_at)
  const integrations = data.integrations
  if (!name) errors.push(`${slug}.md: name is required.`)
  if (!category) errors.push(`${slug}.md: category is required.`)
  if (!contributor) errors.push(`${slug}.md: contributor is required.`)
  if (!addedAt || !DAY.test(addedAt) || Number.isNaN(Date.parse(`${addedAt}T00:00:00Z`))) {
    errors.push(`${slug}.md: added_at must be YYYY-MM-DD.`)
  }
  if (!Array.isArray(integrations) || integrations.length === 0 || integrations.some((item) => item.trim() === '')) {
    errors.push(`${slug}.md: integrations must be a non-empty list.`)
  }
  let grokShareUrl: string | undefined
  if ('grok_share_url' in data) {
    const link = scalar(data.grok_share_url)
    if (!link || !isHttpsUrl(link)) {
      errors.push(`${slug}.md: grok_share_url must be an https URL when it is set.`)
    } else {
      grokShareUrl = link
    }
  }
  if (errors.length > 0 || !name || !category || !contributor || !addedAt || !Array.isArray(integrations)) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    bot: {
      slug,
      name,
      category,
      integrations,
      contributor,
      addedAt,
      summary: body,
      ...(grokShareUrl ? { grokShareUrl } : {}),
    },
  }
}

function scalar(value: FrontValue | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}
