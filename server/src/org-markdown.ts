import {
  quote,
  unquote,
  type FileActivity,
  type OrgDocument,
  type OrgPerson,
  type OrgProfile,
  type WorkDocument,
} from './org-files.js'
import { normalizeText } from './normalize-text.js'

export function serializeOrgMarkdown(org: OrgDocument, profile: OrgProfile): string {
  const lines = [
    '---',
    `name: ${quote(profile.name.trim() || org.company.name)}`,
    `description: ${quote(profile.description.trim())}`,
    `industry: ${quote(profile.industry.trim())}`,
    `size: ${quote(profile.size.trim())}`,
    `people: ${Math.max(0, Math.trunc(profile.people))}`,
    `bots: ${Math.max(0, Math.trunc(profile.bots))}`,
    ...(org.fallbackProcess?.trim() ? [`fallbackProcess: ${quote(org.fallbackProcess.trim())}`] : []),
    `mark: ${quote(org.company.mark?.trim() || '')}`,
    `markColor: ${quote(org.company.markColor?.trim() || '')}`,
    '---',
    '',
    profile.purpose.trim(),
    '',
    '## Departments',
    '',
    ...org.departments.map((department) => `- ${department.id}: ${department.name}`),
    '',
    '## People',
    '',
  ]
  for (const person of org.people) {
    lines.push(`### ${person.id}`, `name: ${quote(person.name)}`)
    for (const key of ['title', 'department', 'email', 'phone', 'location', 'bio', 'startedOn'] as const) {
      const value = person[key]?.trim() ?? ''
      if (value) lines.push(`${key}: ${quote(value)}`)
    }
    lines.push('')
  }
  lines.push('## Chart', '')
  for (const seat of org.seats) {
    lines.push(seat.reportsTo ? `- ${seat.slug}: ${seat.reportsTo}` : `- ${seat.slug}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function parseOrgMarkdown(source: string): { ok: true; org: OrgDocument; profile: OrgProfile } | { ok: false; errors: string[] } {
  const text = normalizeText(source)
  if (!text.startsWith('---')) return { ok: false, errors: ['org.md: missing opening frontmatter.'] }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const close = rest.search(/\r?\n---(?:\r?\n|$)/)
  if (close === -1) return { ok: false, errors: ['org.md: missing closing frontmatter.'] }
  const raw = rest.slice(0, close)
  const body = rest.slice(close).replace(/^\r?\n---\r?\n?/, '')
  const data: Record<string, string> = {}
  const errors: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line)
    if (!field) {
      errors.push(`org.md: cannot read frontmatter line: ${line}`)
      continue
    }
    data[field[1]!] = unquote(field[2] ?? '')
  }
  const name = data.name?.trim() ?? ''
  if (!name) errors.push('org.md: name is required.')
  if (!body.includes('\n## Chart') && !body.startsWith('## Chart')) errors.push('org.md: ## Chart is required.')
  const sections = splitSections(body)
  const departments = (sections.Departments ?? []).flatMap((line) => {
    const item = /^-\s+([a-z0-9-]+):\s*(.*)$/.exec(line.trim())
    if (!item) {
      if (line.trim()) errors.push(`org.md: bad department line: ${line}`)
      return []
    }
    return [{ id: item[1]!, name: item[2]!.trim() || item[1]! }]
  })
  const people: OrgPerson[] = []
  let current: OrgPerson | null = null
  for (const line of sections.People ?? []) {
    const heading = /^###\s+(\S+)\s*$/.exec(line.trim())
    if (heading) {
      if (current) people.push(current)
      current = { id: heading[1]!, name: '' }
      continue
    }
    if (!current || line.trim() === '') continue
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line.trim())
    if (!field) {
      errors.push(`org.md: bad person line: ${line}`)
      continue
    }
    const key = field[1]!
    const value = unquote(field[2] ?? '')
    if (key === 'name' || key === 'title' || key === 'department' || key === 'email' || key === 'phone' || key === 'location' || key === 'bio' || key === 'startedOn') {
      current[key] = value
    }
  }
  if (current) people.push(current)
  for (const person of people) {
    if (!person.name.trim()) errors.push(`org.md: person ${person.id} needs a name.`)
  }
  const seats = (sections.Chart ?? []).flatMap((line) => {
    const item = /^-\s+([a-z0-9]+(?:-[a-z0-9]+)*)(?::\s*([a-z0-9]+(?:-[a-z0-9]+)*))?\s*$/.exec(line.trim())
    if (!item) {
      if (line.trim()) errors.push(`org.md: bad chart line: ${line}`)
      return []
    }
    return [{ slug: item[1]!, reportsTo: item[2] ?? null }]
  })
  if (errors.length) return { ok: false, errors }
  const purpose = (body.startsWith('## ') ? '' : body.split(/\r?\n(?=## )/)[0] ?? '').trim()
  return {
    ok: true,
    org: {
      company: {
        name,
        tagline: data.description?.trim() ?? '',
        industry: data.industry?.trim() ?? '',
        mark: data.mark?.trim() || undefined,
        markColor: data.markColor?.trim() || undefined,
      },
      departments,
      people,
      seats,
      ...(data.fallbackProcess?.trim() ? { fallbackProcess: data.fallbackProcess.trim() } : {}),
    },
    profile: {
      name,
      description: data.description?.trim() ?? '',
      purpose,
      industry: data.industry?.trim() ?? '',
      size: data.size?.trim() ?? '',
      people: whole(data.people),
      bots: whole(data.bots),
    },
  }
}

export function serializeWorkMarkdown(work: WorkDocument): string {
  const lines = ['## Triggers', '']
  for (const trigger of work.triggers) {
    lines.push(
      `### ${trigger.id}`,
      `source: ${quote(trigger.source)}`,
      `label: ${quote(trigger.label)}`,
      `example: ${quote(trigger.example)}`,
      '',
    )
  }
  lines.push('## Workstreams', '')
  for (const stream of work.workstreams) {
    lines.push(
      `### ${stream.id}`,
      `trigger: ${stream.triggerId}`,
      `outcome: ${quote(stream.outcome)}`,
      `owner: ${stream.ownerSeatId}`,
      `kind: ${stream.kind}`,
      `steps: ${stream.stepIds.join(' ')}`,
      '',
    )
  }
  lines.push('## Steps', '')
  for (const step of work.steps) {
    lines.push(
      `### ${step.id}`,
      `workstream: ${step.workstreamId}`,
      `name: ${quote(step.name)}`,
      `level: ${step.level}`,
      `executor: ${step.executorSeatId}`,
    )
    if (step.inputs?.length) lines.push(`inputs: ${JSON.stringify(step.inputs)}`)
    if (step.outputs?.length) lines.push(`outputs: ${JSON.stringify(step.outputs)}`)
    if (step.checkpointId) lines.push(`checkpoint: ${step.checkpointId}`)
    lines.push('')
  }
  lines.push('## Handoffs', '')
  for (const handoff of work.handoffs) {
    lines.push(`### ${handoff.id}`, `from: ${handoff.fromStepId}`, `to: ${handoff.toStepId}`)
    if (handoff.condition) lines.push(`condition: ${quote(handoff.condition)}`)
    lines.push('')
  }
  lines.push('## Checkpoints', '')
  for (const checkpoint of work.checkpoints) {
    lines.push(
      `### ${checkpoint.id}`,
      `step: ${checkpoint.stepId}`,
      `rule: ${quote(checkpoint.rule)}`,
      `approver: ${checkpoint.approverSeatId}`,
      `required: ${checkpoint.required ? 'true' : 'false'}`,
      '',
    )
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

export function parseWorkMarkdown(source: string): { ok: true; work: WorkDocument } | { ok: false; errors: string[] } {
  const sections = splitSections(normalizeText(source))
  const errors: string[] = []
  const work: WorkDocument = { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] }
  work.triggers = blocks(sections.Triggers ?? []).flatMap((block) => {
    const fields = fieldsOf(block.lines, errors, 'work-chart.md')
    if (!fields) return []
    return [{ id: block.id, source: fields.source ?? '', label: fields.label ?? '', example: fields.example ?? '' }]
  })
  work.workstreams = blocks(sections.Workstreams ?? []).flatMap((block) => {
    const fields = fieldsOf(block.lines, errors, 'work-chart.md')
    if (!fields) return []
    const kind = fields.kind === 'contingency' ? 'contingency' : 'main'
    if (fields.kind && fields.kind !== 'main' && fields.kind !== 'contingency') errors.push(`work-chart.md: ${block.id} kind must be main or contingency.`)
    return [{
      id: block.id,
      triggerId: fields.trigger ?? '',
      outcome: fields.outcome ?? '',
      ownerSeatId: fields.owner ?? '',
      kind,
      stepIds: (fields.steps ?? '').split(/\s+/).filter(Boolean),
    }]
  })
  work.steps = blocks(sections.Steps ?? []).flatMap((block) => {
    const fields = fieldsOf(block.lines, errors, 'work-chart.md')
    if (!fields) return []
    const level = Number(fields.level)
    if (level !== 2 && level !== 3 && level !== 4) errors.push(`work-chart.md: ${block.id} level must be 2, 3, or 4.`)
    return [{
      id: block.id,
      workstreamId: fields.workstream ?? '',
      name: fields.name ?? '',
      level: (level === 3 || level === 4 ? level : 2) as 2 | 3 | 4,
      executorSeatId: fields.executor ?? '',
      inputs: readList(fields.inputs),
      outputs: readList(fields.outputs),
      checkpointId: fields.checkpoint || undefined,
    }]
  })
  work.handoffs = blocks(sections.Handoffs ?? []).flatMap((block) => {
    const fields = fieldsOf(block.lines, errors, 'work-chart.md')
    if (!fields) return []
    return [{ id: block.id, fromStepId: fields.from ?? '', toStepId: fields.to ?? '', condition: fields.condition || undefined }]
  })
  work.checkpoints = blocks(sections.Checkpoints ?? []).flatMap((block) => {
    const fields = fieldsOf(block.lines, errors, 'work-chart.md')
    if (!fields) return []
    return [{
      id: block.id,
      stepId: fields.step ?? '',
      rule: fields.rule ?? '',
      approverSeatId: fields.approver ?? '',
      required: fields.required !== 'false',
    }]
  })
  if (!work.triggers.length) errors.push('work-chart.md: at least one trigger is required.')
  if (errors.length) return { ok: false, errors }
  return { ok: true, work }
}

export function logFileName(id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return `${slug || 'event'}.md`
}

export function serializeLogMarkdown(event: FileActivity): string {
  const lines = [
    '---',
    `id: ${quote(event.id)}`,
    `type: ${event.type}`,
    `actorSeatId: ${quote(event.actorSeatId)}`,
    `actorType: ${event.actorType}`,
    `timestamp: ${quote(event.timestamp)}`,
  ]
  if (event.subjectSeatId) lines.push(`subjectSeatId: ${quote(event.subjectSeatId)}`)
  if (event.stepId) lines.push(`stepId: ${quote(event.stepId)}`)
  if (event.workstreamId) lines.push(`workstreamId: ${quote(event.workstreamId)}`)
  if (event.status) lines.push(`status: ${quote(event.status)}`)
  if (event.approverSeatId) lines.push(`approverSeatId: ${quote(event.approverSeatId)}`)
  if (event.grok) lines.push(`grok: ${event.grok}`)
  if (event.kind && /^[a-z][a-z-]*$/.test(event.kind)) lines.push(`kind: ${event.kind}`)
  if (event.stats) lines.push(`stats: ${quote(event.stats.replace(/\s+/g, ' ').trim())}`)
  // One frontmatter line: the rows split on ;, which a row never holds.
  const runs = (event.runs ?? []).map((row) => row.replace(/;/g, ',').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (runs.length) lines.push(`runs: ${quote(runs.join(';'))}`)
  lines.push('---', '', event.summary.trim(), '')
  return lines.join('\n')
}

export function parseLogMarkdown(source: string, file = 'log'): { ok: true; event: FileActivity } | { ok: false; errors: string[] } {
  const text = normalizeText(source)
  if (!text.startsWith('---')) return { ok: false, errors: [`${file}: missing opening frontmatter.`] }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const close = rest.search(/\r?\n---(?:\r?\n|$)/)
  if (close === -1) return { ok: false, errors: [`${file}: missing closing frontmatter.`] }
  const data: Record<string, string> = {}
  const errors: string[] = []
  for (const line of rest.slice(0, close).split(/\r?\n/)) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line)
    if (!field) {
      errors.push(`${file}: cannot read frontmatter line: ${line}`)
      continue
    }
    data[field[1]!] = unquote(field[2] ?? '')
  }
  const summary = rest.slice(close).replace(/^\r?\n---\r?\n?/, '').trim()
  if (!data.id?.trim()) errors.push(`${file}: id is required.`)
  if (!summary) errors.push(`${file}: summary is required.`)
  if (errors.length) return { ok: false, errors }
  const event: FileActivity = {
    id: data.id!.trim(),
    orgId: '',
    type: data.type as FileActivity['type'],
    actorSeatId: data.actorSeatId ?? '',
    actorType: data.actorType as FileActivity['actorType'],
    timestamp: data.timestamp ?? '',
    summary,
    subjectSeatId: data.subjectSeatId || undefined,
    stepId: data.stepId || undefined,
    workstreamId: data.workstreamId || undefined,
    status: data.status || undefined,
    approverSeatId: data.approverSeatId || undefined,
    grok: data.grok === 'in' || data.grok === 'out' ? data.grok : undefined,
    kind: data.kind && /^[a-z][a-z-]*$/.test(data.kind) ? data.kind : undefined,
    stats: data.stats?.trim() || undefined,
  }
  const runs = (data.runs ?? '').split(';').map((row) => row.trim()).filter(Boolean)
  if (runs.length) event.runs = runs
  return { ok: true, event }
}

function whole(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value.trim())) return 0
  return Number(value.trim())
}

function splitSections(body: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {}
  let name = ''
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      name = heading[1]!.trim()
      sections[name] = []
      continue
    }
    if (name) sections[name]!.push(line)
  }
  return sections
}

function blocks(lines: string[]): { id: string; lines: string[] }[] {
  const out: { id: string; lines: string[] }[] = []
  let current: { id: string; lines: string[] } | null = null
  for (const line of lines) {
    const heading = /^###\s+(\S+)\s*$/.exec(line.trim())
    if (heading) {
      if (current) out.push(current)
      current = { id: heading[1]!, lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }
  if (current) out.push(current)
  return out
}

function fieldsOf(lines: string[], errors: string[], file: string): Record<string, string> | null {
  const fields: Record<string, string> = {}
  for (const line of lines) {
    if (line.trim() === '') continue
    const field = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line.trim())
    if (!field) {
      errors.push(`${file}: cannot read line: ${line}`)
      continue
    }
    fields[field[1]!] = unquote(field[2] ?? '')
  }
  return fields
}

function readList(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined
  if (value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown
      if (Array.isArray(parsed)) return parsed.map((item) => String(item))
    } catch {
      return undefined
    }
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}
