import { companyFromBundle } from './company.ts'
import { bundleFrom } from './load.ts'
import { rememberSampleProfile } from './sample-profiles.ts'
import { parseOrgProfile, type OrgBundle, type OrgDocument, type WorkDocument } from '../../server/src/org-files.ts'
import { parseProcessMarkdown, type ProcessFile } from '../../server/src/processes.ts'
import { isRunLogName, parseRunLog, type RunLine } from '../../server/src/run-log.ts'
import type { CompanySeed } from '../data/mock-companies.ts'

const sampleOrg = import.meta.glob('../../samples/*/org.json', { import: 'default' }) as Record<string, () => Promise<OrgDocument>>
const sampleSeats = import.meta.glob('../../samples/*/seats/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const sampleWork = import.meta.glob('../../samples/*/workchart.json', { import: 'default' }) as Record<string, () => Promise<WorkDocument>>
const sampleActivity = import.meta.glob('../../samples/*/activity.jsonl', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const sampleProfiles = import.meta.glob('../../samples/*/org.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const sampleProcesses = import.meta.glob('../../samples/*/processes/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const sampleRunLogs = import.meta.glob('../../samples/*/log/*.md', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>

export type LoadedSample = { bundle: OrgBundle; company: CompanySeed }

const cache = new Map<string, Promise<LoadedSample | undefined>>()

/** Load one sample company. Other sample folders stay unloaded. */
export function loadFileSample(id: string): Promise<LoadedSample | undefined> {
  const pending = cache.get(id)
  if (pending) return pending
  const next = readSample(id)
  cache.set(id, next)
  return next
}

async function readSample(id: string): Promise<LoadedSample | undefined> {
  const orgPath = Object.keys(sampleOrg).find((path) => path.includes(`/samples/${id}/org.json`))
  if (!orgPath) return undefined
  const org = await sampleOrg[orgPath]!()
  const work = await sampleWork[orgPath.replace(/org\.json$/, 'workchart.json')]!()
  const seatFiles: Record<string, string> = {}
  await Promise.all(
    Object.entries(sampleSeats)
      .filter(([path]) => path.includes(`/samples/${id}/seats/`))
      .map(async ([path, load]) => {
        seatFiles[path] = await load()
      }),
  )
  const activityFiles: Record<string, string> = {}
  const activityPath = Object.keys(sampleActivity).find((path) => path.includes(`/samples/${id}/activity.jsonl`))
  if (activityPath) activityFiles[activityPath] = await sampleActivity[activityPath]!()
  const profilePath = Object.keys(sampleProfiles).find((path) => path.includes(`/samples/${id}/org.md`))
  if (profilePath) {
    const parsed = parseOrgProfile(await sampleProfiles[profilePath]!())
    if (parsed.ok) rememberSampleProfile(id, parsed.profile)
  }
  const processes: ProcessFile[] = []
  await Promise.all(
    Object.entries(sampleProcesses)
      .filter(([path]) => path.includes(`/samples/${id}/processes/`))
      .map(async ([path, load]) => {
        const slug = path.split('/').pop()?.replace(/\.md$/, '') || ''
        const parsed = parseProcessMarkdown(slug, await load())
        if (parsed.ok) processes.push(parsed.process)
      }),
  )
  processes.sort((a, b) => a.slug.localeCompare(b.slug))
  const runChunks = await Promise.all(
    Object.entries(sampleRunLogs)
      .filter(([path]) => path.includes(`/samples/${id}/log/`) && isRunLogName(path.split('/').pop() || ''))
      .map(async ([path, load]) => ({ name: path.split('/').pop() || '', text: await load() })),
  )
  runChunks.sort((a, b) => a.name.localeCompare(b.name))
  const runLog: RunLine[] = []
  for (const chunk of runChunks) {
    const parsed = parseRunLog(chunk.text, chunk.name.slice(0, 10))
    for (const line of parsed.lines) runLog.push({ ...line, index: runLog.length })
  }
  const bundle = bundleFrom(id, org, seatFiles, work, `/samples/${id}/seats/`, activityFiles, `/samples/${id}/activity.jsonl`)
  return { bundle: { ...bundle, processes, fallbackProcess: org.fallbackProcess || 'triage', runLog }, company: companyFromBundle(bundle) }
}
