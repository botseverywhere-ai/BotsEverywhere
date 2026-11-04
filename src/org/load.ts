import { companyFromBundle } from './company.ts'
import { rememberedSampleProfile } from './sample-profiles.ts'
import { parseLogMarkdown, parseOrgMarkdown, parseWorkMarkdown } from '../../server/src/org-markdown.ts'
import { isRunLogName } from '../../server/src/run-log.ts'
import { bundleFromState, parseActivityLog, parseOrgProfile, parseSeatMarkdown, validateBundle, type FileActivity, type OrgBundle, type OrgDocument, type OrgProfile, type WorkDocument } from '../../server/src/org-files.ts'
import type { CompanySeed } from '../data/mock-companies.ts'

const userOrgJson = import.meta.glob('../../orgs/*/org.json', { eager: true, import: 'default' }) as Record<string, OrgDocument>
const userOrgMd = import.meta.glob('../../orgs/*/org.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const userSeats = import.meta.glob('../../orgs/*/seats/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const userWork = import.meta.glob('../../orgs/*/workchart.json', { eager: true, import: 'default' }) as Record<string, WorkDocument>
const userWorkMd = import.meta.glob('../../orgs/*/work-chart.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const userActivity = import.meta.glob('../../orgs/*/activity.jsonl', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const userLogs = import.meta.glob('../../orgs/*/log/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const userProfiles = import.meta.glob('../../orgs/*/org.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

export function storedProfile(kind: 'user' | 'sample', id: string): OrgProfile | null {
  if (kind === 'sample') return rememberedSampleProfile(id)
  const source = Object.entries(userProfiles).find(([path]) => path.includes(`/${id}/org.md`))?.[1]
  if (!source) return null
  const parsed = parseOrgProfile(source)
  return parsed.ok ? parsed.profile : null
}

export const DEFAULT_ORG_SLUG = 'your-company'

export function bundleFrom(
  id: string,
  org: OrgDocument,
  seatFiles: Record<string, string>,
  work: WorkDocument,
  seatPrefix: string,
  activityFiles: Record<string, string>,
  activityPrefix: string,
): OrgBundle {
  const seats = Object.entries(seatFiles)
    .filter(([path]) => path.includes(seatPrefix))
    .map(([path, source]) => {
      const slug = path.split('/').pop()!.replace(/\.md$/, '')
      const parsed = parseSeatMarkdown(slug, source)
      if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
      return parsed.seat
    })
  const activityText = Object.entries(activityFiles).find(([path]) => path.includes(activityPrefix))?.[1] ?? ''
  const activity = parseActivityLog(activityText, id)
  if (!activity.ok) throw new Error(activity.errors.join('\n'))
  const bundle: OrgBundle = { id, org, seats, work, activity: activity.events }
  const errors = validateBundle(bundle)
  if (errors.length) throw new Error(errors.join('\n'))
  return bundle
}

function orgIdFrom(path: string): string {
  const parts = path.split('/')
  const orgsAt = parts.lastIndexOf('orgs')
  return parts[orgsAt + 1] ?? ''
}

function logsFor(id: string): FileActivity[] {
  const events: FileActivity[] = []
  const seen = new Set<string>()
  for (const [path, source] of Object.entries(userLogs)) {
    if (!path.includes(`/orgs/${id}/log/`)) continue
    const name = path.split('/').pop() || ''
    if (isRunLogName(name)) continue
    let parsed: ReturnType<typeof parseLogMarkdown>
    try {
      parsed = parseLogMarkdown(source, path)
    } catch {
      continue
    }
    if (!parsed.ok) continue
    if (seen.has(parsed.event.id)) continue
    seen.add(parsed.event.id)
    events.push({ ...parsed.event, orgId: id })
  }
  const legacy = Object.entries(userActivity).find(([path]) => path.includes(`/orgs/${id}/activity.jsonl`))?.[1] ?? ''
  if (legacy.trim()) {
    let parsed: ReturnType<typeof parseActivityLog>
    try {
      parsed = parseActivityLog(legacy, id)
    } catch {
      parsed = { ok: false, errors: [] }
    }
    if (!parsed.ok) return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
    for (const event of parsed.events) {
      if (seen.has(event.id)) continue
      seen.add(event.id)
      events.push(event)
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
}

const markdownOrgs: { id: string; bundle: OrgBundle; company: CompanySeed }[] = Object.entries(userOrgMd).flatMap(([path, source]) => {
  try {
    if (!source.includes('\n## Chart') && !source.startsWith('## Chart')) return []
    const id = orgIdFrom(path)
    const parsed = parseOrgMarkdown(source)
    if (!parsed.ok) return []
    const workSource = userWorkMd[path.replace(/org\.md$/, 'work-chart.md')]
    if (!workSource) return []
    const work = parseWorkMarkdown(workSource)
    if (!work.ok) return []
    const seats = Object.entries(userSeats)
      .filter(([seatPath]) => seatPath.includes(`/orgs/${id}/seats/`))
      .flatMap(([seatPath, seatSource]) => {
        const slug = seatPath.split('/').pop()!.replace(/\.md$/, '')
        const seat = parseSeatMarkdown(slug, seatSource)
        return seat.ok ? [seat.seat] : []
      })
    const bundle = bundleFromState(id, parsed.org, seats, work.work, logsFor(id))
    if (validateBundle(bundle).length) return []
    return [{ id, bundle, company: companyFromBundle(bundle) }]
  } catch {
    return []
  }
})

const markdownIds = new Set(markdownOrgs.map((item) => item.id))

export const userOrgs: { id: string; bundle: OrgBundle; company: CompanySeed }[] = [
  ...markdownOrgs,
  ...Object.entries(userOrgJson).flatMap(([path, org]) => {
    try {
      const id = orgIdFrom(path)
      if (markdownIds.has(id)) return []
      const bundle = bundleFrom(id, org, userSeats, userWork[path.replace(/org\.json$/, 'workchart.json')]!, `/orgs/${id}/seats/`, userActivity, `/orgs/${id}/activity.jsonl`)
      return [{ id, bundle, company: companyFromBundle(bundle) }]
    } catch {
      return []
    }
  }),
]

export function userOrg(id: string) {
  return userOrgs.find((item) => item.id === id)
}

function unreadBundle(): OrgBundle {
  return {
    id: DEFAULT_ORG_SLUG,
    org: {
      company: { name: 'Your organization', tagline: '', industry: '', mark: '', markColor: '' },
      departments: [],
      people: [],
      seats: [],
    },
    seats: [],
    work: { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] },
    activity: [],
  }
}

export const templateBundle: OrgBundle = userOrg(DEFAULT_ORG_SLUG)?.bundle ?? userOrgs[0]?.bundle ?? unreadBundle()
export const templateCompany: CompanySeed = companyFromBundle(templateBundle)

export function humanBotLabel(seats: { type: string; status?: string }[]) {
  const active = seats.filter((seat) => seat.status !== 'retired')
  const humans = active.filter((seat) => seat.type === 'human').length
  const bots = active.filter((seat) => seat.type === 'bot').length
  const humanWord = humans === 1 ? 'human' : 'humans'
  const botWord = bots === 1 ? 'bot' : 'bots'
  return { humans, bots, label: `${humans} ${humanWord} · ${bots} ${botWord}` }
}
