import { isGrokBotUrl, SEAT_SLUG } from './org-files.js'

export const DIRECTORY_CATEGORIES = [
  'Team management',
  'Sales',
  'Finance',
  'HR',
  'Ops',
  'Research',
  'Marketing',
  'Engineering',
  'Support',
  'Legal & Compliance',
  'Executive/Admin',
  'Product',
  'Customer Success',
  'Procurement',
  'IT',
  'Security',
  'Data',
  'Events/Community',
  'Content/SEO',
] as const

/** Featured bots. Meetup stays here and is not one of the core 20. */
export const FEATURED_SLUGS = [
  'invoice-bot',
  'request-bot',
  'campaign-bot',
  'work-chart-bot',
  'chief-of-staff-bot',
  'handoff-bot',
  'role-card-bot',
  'sales-follow-up-bot',
  'meetup-bot',
  'backup-plan-bot',
] as const

/** Everyday core bots, in the order the directory index shows them. */
export const CORE_EVERYDAY = [
  'support-bot',
  'invoice-bot',
  'collections-bot',
  'sales-follow-up-bot',
  'expense-bot',
  'scheduling-bot',
  'request-bot',
  'inbox-bot',
  'onboarding-bot',
  'chief-of-staff-bot',
] as const

/** Work chart core bots, in the order the directory index shows them. */
export const CORE_WORKCHART = [
  'work-chart-bot',
  'role-card-bot',
  'handoff-bot',
  'backup-plan-bot',
  'campaign-bot',
  'candidate-bot',
  'contract-bot',
  'subscription-bot',
  'weekly-numbers-bot',
  'access-review-bot',
] as const

export const CORE_GROUPS = ['Everyday', 'Work chart'] as const

export type CoreGroup = (typeof CORE_GROUPS)[number]

export type DirectoryCategory = (typeof DIRECTORY_CATEGORIES)[number]

/** Shape the hire drawer already fills from a directory bot. */
export interface DirectoryEntry {
  id: string
  name: string
  seatCard: {
    owns: string[]
    may: string[]
    mustAskBefore: string[]
    doneWhen: string[]
  }
}

export interface DirectoryBot {
  slug: string
  name: string
  category: DirectoryCategory
  summary: string
  featured: boolean
  core: boolean
  group: CoreGroup | ''
  addToGrokBotUrl: string | null
  trigger: string
  owns: string[]
  may: string[]
  mustAskBefore: string[]
  doneWhen: string[]
  prompt: string
}

const CARD_KEYS = ['owns', 'may', 'mustAskBefore', 'doneWhen'] as const

/** Markdown in directory/ that tracks work and is not a bot. */
export const DIRECTORY_SKIP_FILES = ['PUBLISH-QUEUE.md'] as const

export function isDirectoryBotFile(filename: string): boolean {
  return filename.endsWith('.md') && !(DIRECTORY_SKIP_FILES as readonly string[]).includes(filename)
}

export function parseDirectoryMarkdown(slug: string, source: string): { ok: true; bot: DirectoryBot } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const where = `${slug}.md`
  if (!SEAT_SLUG.test(slug)) errors.push(`${where}: filename must be a lowercase slug.`)
  const text = source.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return { ok: false, errors: [`${where}: missing opening frontmatter.`] }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const close = rest.search(/\r?\n---(?:\r?\n|$)/)
  if (close === -1) return { ok: false, errors: [`${where}: missing closing frontmatter.`] }
  const raw = rest.slice(0, close)
  const prompt = rest.slice(close).replace(/^\r?\n---\r?\n?/, '').trim()
  const data: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line)
    if (!field) {
      errors.push(`${where}: cannot read frontmatter line: ${line}`)
      continue
    }
    data[field[1]!] = unquote(field[2] ?? '')
  }
  const name = data.name?.trim() ?? ''
  const fileSlug = data.slug?.trim() ?? ''
  const category = data.category?.trim() ?? ''
  const summary = data.summary?.trim() ?? ''
  const trigger = data.trigger?.trim() ?? ''
  const featuredRaw = data.featured?.trim() ?? ''
  const coreRaw = data.core?.trim() ?? ''
  const groupRaw = data.group?.trim() ?? ''
  const linkRaw = data.addToGrokBotUrl?.trim() ?? ''
  if (!name) errors.push(`${where}: name is required.`)
  if (fileSlug !== slug) errors.push(`${where}: slug must match the filename.`)
  if (!DIRECTORY_CATEGORIES.includes(category as DirectoryCategory)) {
    errors.push(`${where}: category must be one of ${DIRECTORY_CATEGORIES.join(', ')}.`)
  }
  if (!summary) errors.push(`${where}: summary is required.`)
  if (!trigger) errors.push(`${where}: trigger is required.`)
  let featured = false
  if (featuredRaw === '' || featuredRaw === 'false') featured = false
  else if (featuredRaw === 'true') featured = true
  else errors.push(`${where}: featured must be true or false.`)
  let core = false
  if (coreRaw === '' || coreRaw === 'false') core = false
  else if (coreRaw === 'true') core = true
  else errors.push(`${where}: core must be true or false.`)
  let group: CoreGroup | '' = ''
  if (groupRaw === '') group = ''
  else if ((CORE_GROUPS as readonly string[]).includes(groupRaw)) group = groupRaw as CoreGroup
  else errors.push(`${where}: group must be Everyday or Work chart.`)
  if (core && !group) errors.push(`${where}: a core bot needs a group.`)
  if (!core && group) errors.push(`${where}: group is only for a core bot.`)
  if (!prompt) errors.push(`${where}: the prompt body is required.`)
  let addToGrokBotUrl: string | null = null
  if (linkRaw === '' || linkRaw === 'null') addToGrokBotUrl = null
  else if (isGrokBotUrl(linkRaw)) addToGrokBotUrl = linkRaw
  else errors.push(`${where}: addToGrokBotUrl must be null or https://x.ai/bot/…`)
  const owns = splitList(data.owns)
  const may = splitList(data.may)
  const mustAskBefore = splitList(data.mustAskBefore)
  const doneWhen = splitList(data.doneWhen)
  for (const key of CARD_KEYS) {
    const lines = key === 'owns' ? owns : key === 'may' ? may : key === 'mustAskBefore' ? mustAskBefore : doneWhen
    if (!lines.length) errors.push(`${where}: ${key} needs at least one line.`)
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    bot: {
      slug,
      name,
      category: category as DirectoryCategory,
      summary,
      featured,
      core,
      group,
      addToGrokBotUrl,
      trigger,
      owns,
      may,
      mustAskBefore,
      doneWhen,
      prompt,
    },
  }
}

export function validateDirectoryCatalog(bots: DirectoryBot[]): string[] {
  const errors: string[] = []
  if (bots.length < 130 || bots.length > 150) errors.push(`directory: expected about 137 bots, found ${bots.length}.`)
  const featured = bots.filter((bot) => bot.featured).map((bot) => bot.slug)
  if (featured.length !== FEATURED_SLUGS.length) {
    errors.push(`directory: expected ${FEATURED_SLUGS.length} featured bots, found ${featured.length}.`)
  }
  for (const slug of FEATURED_SLUGS) {
    if (!featured.includes(slug)) errors.push(`directory: ${slug} should be featured.`)
  }
  for (const slug of featured) {
    if (!(FEATURED_SLUGS as readonly string[]).includes(slug)) errors.push(`directory/${slug}.md: featured is reserved for the featured list.`)
  }
  const coreGroup = new Map<string, CoreGroup>()
  for (const slug of CORE_EVERYDAY) coreGroup.set(slug, 'Everyday')
  for (const slug of CORE_WORKCHART) coreGroup.set(slug, 'Work chart')
  for (const bot of bots) {
    const where = `directory/${bot.slug}.md`
    const want = coreGroup.get(bot.slug)
    if (bot.core) {
      if (!want) errors.push(`${where}: core is reserved for the core 20.`)
      else if (bot.group !== want) errors.push(`${where}: group must be ${want}.`)
    } else if (want) {
      errors.push(`${where}: this bot is one of the core 20.`)
    } else if (bot.group) {
      errors.push(`${where}: group is only for a core bot.`)
    }
  }
  if (bots.filter((bot) => bot.core).length !== coreGroup.size) {
    errors.push(`directory: expected ${coreGroup.size} core bots.`)
  }
  const meetup = bots.find((bot) => bot.slug === 'meetup-bot')
  if (meetup?.core) errors.push('directory/meetup-bot.md: Meetup stays non-core.')
  const slugs = new Set<string>()
  const names = new Set<string>()
  const seen = new Set<string>()
  for (const bot of bots) {
    const where = `directory/${bot.slug}.md`
    if (slugs.has(bot.slug)) errors.push(`${where}: duplicate slug.`)
    slugs.add(bot.slug)
    if (names.has(bot.name)) errors.push(`${where}: duplicate name.`)
    names.add(bot.name)
    seen.add(bot.category)
    if (bot.addToGrokBotUrl !== null && !isGrokBotUrl(bot.addToGrokBotUrl)) {
      errors.push(`${where}: addToGrokBotUrl must be https://x.ai/bot/…`)
    }
    const words = wordCount(bot.prompt)
    if (words < 120 || words > 250) errors.push(`${where}: prompt is ${words} words; it must be 120 to 250.`)
    const blob = [bot.name, bot.summary, bot.trigger, bot.prompt, ...bot.owns, ...bot.may, ...bot.mustAskBefore, ...bot.doneWhen].join('\n')
    if (/endors/i.test(blob)) errors.push(`${where}: do not mark the bot as endorsed.`)
    if (/https?:\/\//i.test(blob)) errors.push(`${where}: do not put URLs in the catalog copy.`)
    if (/\d+(?:\.\d+)?\s*%/.test(blob)) errors.push(`${where}: do not invent a statistic.`)
  }
  for (const category of DIRECTORY_CATEGORIES) {
    if (!seen.has(category)) errors.push(`directory: no bot in ${category}.`)
  }
  return errors
}

export function toDirectoryEntry(bot: DirectoryBot): DirectoryEntry {
  return {
    id: bot.slug,
    name: bot.name,
    seatCard: {
      owns: bot.owns,
      may: bot.may,
      mustAskBefore: bot.mustAskBefore,
      doneWhen: bot.doneWhen,
    },
  }
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function splitList(value: string | undefined): string[] {
  if (!value?.trim()) return []
  return value.split('|').map((item) => item.trim()).filter(Boolean)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
