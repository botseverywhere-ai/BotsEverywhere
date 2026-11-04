import { rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import raw from '../src/data/mock-companies.json' with { type: 'json' }
import type { CompanySeed, Seat } from '../src/data/mock-companies.ts'
import { isGrokBotUrl, serializeSeat, type OrgBundle, type OrgPerson, type SeatDocument, type WorkDocument } from '../server/src/org-files.ts'
import { writeOrgDir } from '../server/src/template-server.ts'

/**
 * Writes samples/<id>/ for every organization in src/data/mock-companies.json. ONLY=<id> exports one of them.
 * JSON_SAMPLES=1 writes org.json, workchart.json, and activity.jsonl beside the seat files, the format the shipped
 * samples use, in place of org.md and work-chart.md.
 */
const seed = raw as { companies: CompanySeed[] }
const only = process.env.ONLY?.trim()
const asJson = process.env.JSON_SAMPLES === '1'

for (const company of seed.companies) {
  if (only && company.org.id !== only) continue
  const root = resolve('samples', company.org.id)
  const bundle = toBundle(company)
  const written = writeOrgDir(root, bundle)
  if (written.errors.length) {
    console.error(written.errors.join('\n'))
    process.exit(1)
  }
  if (asJson) {
    writeFileSync(resolve(root, 'org.json'), `${JSON.stringify(bundle.org, null, 2)}\n`)
    writeFileSync(resolve(root, 'workchart.json'), `${JSON.stringify(bundle.work, null, 2)}\n`)
    const events = (company.log ?? []).map((event) => JSON.stringify(event)).join('\n')
    writeFileSync(resolve(root, 'activity.jsonl'), events ? `${events}\n` : '')
    rmSync(resolve(root, 'org.md'), { force: true })
    rmSync(resolve(root, 'work-chart.md'), { force: true })
  }
  console.log(`${company.org.id}: ${written.files.length} files${asJson ? ' (json)' : ''}`)
}

function toBundle(company: CompanySeed): OrgBundle {
  const departments: { id: string; name: string }[] = []
  const byLabel = new Map<string, string>()
  const people: OrgPerson[] = []
  const seats = company.seats.map((seat) => seatFile(seat, departments, byLabel, people))
  const work: WorkDocument = {
    triggers: company.triggers.map((trigger) => ({
      id: trigger.id,
      source: trigger.source,
      label: trigger.label,
      example: trigger.example,
    })),
    workstreams: company.workstreams.map((stream) => ({
      id: stream.id,
      triggerId: stream.triggerId,
      outcome: stream.outcome,
      ownerSeatId: stream.ownerSeatId,
      kind: stream.kind,
      stepIds: stream.stepIds,
    })),
    steps: company.steps.map((step) => ({
      id: step.id,
      workstreamId: step.workstreamId,
      name: step.name,
      level: step.level === 3 || step.level === 4 ? step.level : 2,
      executorSeatId: step.executorSeatId,
      inputs: step.inputs ?? [],
      outputs: step.outputs ?? [],
      checkpointId: step.checkpointId,
    })),
    handoffs: company.handoffs.map((hand) => ({
      id: hand.id,
      fromStepId: hand.fromStepId,
      toStepId: hand.toStepId,
      condition: hand.condition,
    })),
    checkpoints: company.checkpoints.map((point) => ({
      id: point.id,
      stepId: point.stepId,
      rule: point.rule,
      approverSeatId: point.approverSeatId,
      required: point.required,
    })),
  }
  return {
    id: company.org.id,
    org: {
      company: {
        name: company.org.name,
        tagline: company.org.tagline,
        industry: company.org.industry,
        mark: company.org.mark,
        markColor: company.org.markColor,
      },
      departments,
      people,
      seats: seats.map((seat) => ({ slug: seat.slug, reportsTo: seat.reportsTo || null })),
    },
    seats,
    work,
  }
}

function seatFile(seat: Seat, departments: { id: string; name: string }[], byLabel: Map<string, string>, people: OrgPerson[]): SeatDocument {
  const label = seat.profile?.department?.trim() || 'General'
  let department = byLabel.get(label)
  if (!department) {
    department = uniqueDept(label, new Set(departments.map((item) => item.id)))
    departments.push({ id: department, name: label })
    byLabel.set(label, department)
  }
  const personId = seat.profile || seat.type === 'human' ? `person-${seat.id}` : ''
  if (personId) {
    people.push({
      id: personId,
      name: seat.name,
      title: seat.role,
      department,
      email: seat.profile?.email ?? '',
      phone: seat.profile?.phone ?? '',
      location: seat.profile?.location ?? '',
      bio: seat.profile?.bio ?? '',
      startedOn: seat.profile?.startedOn ?? '',
    })
  }
  const share = seat.addToGrokBotUrl && isGrokBotUrl(seat.addToGrokBotUrl) ? seat.addToGrokBotUrl : ''
  const draft = {
    slug: seat.id,
    title: seat.name,
    department,
    reportsTo: seat.reportsTo ?? '',
    addToGrokBotUrl: share,
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    status: seat.status === 'retired' ? ('retired' as const) : ('active' as const),
    kind: seat.type,
    role: seat.role || seat.name,
    personId,
    owns: lines(seat.card.owns),
    may: lines(seat.card.may),
    mustAskBefore: lines(seat.card.mustAskBefore),
    doneWhen: lines(seat.card.doneWhen),
  }
  return { ...draft, source: serializeSeat(draft) }
}

function lines(items: string[] | undefined): string[] {
  return (items ?? []).map((item) => item.trim()).filter(Boolean)
}

function uniqueDept(label: string, used: Set<string>): string {
  const base = label.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'general'
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  return id
}
