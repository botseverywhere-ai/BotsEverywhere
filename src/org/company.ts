import type { CompanySeed, Seat, TriggerSource } from '../data/mock-companies.ts'
import { isGreyed, seatStats, type OrgBundle, type OrgDocument } from '../../server/src/org-files.ts'

const SOURCES: TriggerSource[] = ['email', 'chat', 'meeting', 'dashboard', 'customer', 'alert', 'management', 'schedule']

export function companyFromBundle(bundle: OrgBundle): CompanySeed {
  const people = new Map(bundle.org.people.map((person) => [person.id, person]))
  const seats: Seat[] = bundle.seats.map((seat) => {
    const person = seat.personId ? people.get(seat.personId) : undefined
    return {
      id: seat.slug,
      orgId: bundle.id,
      name: seat.title,
      role: seat.role || seat.title,
      ...(seat.description?.trim() ? { description: seat.description.trim() } : {}),
      type: seat.kind,
      reportsTo: seat.reportsTo || undefined,
      ...(seat.alsoReportsTo?.length ? { alsoReportsTo: seat.alsoReportsTo } : {}),
      ...(isGreyed(seat) ? { elsewhere: [] } : {}),
      grokShareUrl: seat.addToGrokBotUrl || null,
      addToGrokBotUrl: seat.addToGrokBotUrl || null,
      grokBotUrl: seat.grokBotUrl || null,
      prompt: seat.source,
      curated: true,
      status: seat.status === 'retired' ? 'retired' : 'active',
      card: {
        owns: seat.owns,
        may: seat.may,
        mustAskBefore: seat.mustAskBefore,
        doneWhen: seat.doneWhen,
      },
      ...(seat.createdAt ? { createdAt: seat.createdAt } : {}),
      ...(seat.lastActive ? { importedLastActive: seat.lastActive } : {}),
      ...(seat.runs30d !== undefined ? { runs30d: seat.runs30d } : {}),
      ...(seat.tasksDone30d !== undefined ? { importedTasks30d: seat.tasksDone30d } : {}),
      ...(seat.routines?.length ? { routines: seat.routines } : {}),
      ...(seat.kind === 'bot' ? { origin: seat.seatOrigin === 'existing' ? 'imported' as const : seat.directoryId ? 'directory' as const : 'manual' as const } : {}),
      ...(seat.directoryId ? { directoryId: seat.directoryId } : {}),
      ...(seat.skills?.length ? { skills: seat.skills } : {}),
      ...(seat.apps?.length ? { apps: seat.apps } : {}),
      ...(seat.instructions ? { instructions: seat.instructions } : {}),
      ...(seat.publicUrl ? { publicUrl: seat.publicUrl } : {}),
      ...(seat.grokSync ? { grokSync: seat.grokSync } : {}),
      ...(seat.grokSyncedAt ? { grokSyncedAt: seat.grokSyncedAt } : {}),
      ...(seat.grokMissingSince ? { grokMissingSince: seat.grokMissingSince } : {}),
      stats: seat.kind === 'bot' ? seatStats(bundle.activity, seat.slug) : undefined,
      profile: {
        department: departmentName(bundle.org, seat.department),
        location: person?.location ?? '',
        email: person?.email ?? '',
        phone: person?.phone ?? '',
        startedOn: person?.startedOn ?? '',
        bio: person?.bio || person?.name || seat.title,
      },
    }
  })
  return {
    org: {
      id: bundle.id,
      name: bundle.org.company.name,
      industry: bundle.org.company.industry || 'Team',
      mock: bundle.id !== 'org',
      tagline: bundle.org.company.tagline,
      mark: bundle.org.company.mark || initials(bundle.org.company.name),
      markColor: bundle.org.company.markColor || '#0B1220',
      seatIds: seats.map((seat) => seat.id),
      workstreamIds: bundle.work.workstreams.map((stream) => stream.id),
    },
    seats,
    triggers: bundle.work.triggers.map((trigger) => ({
      id: trigger.id,
      orgId: bundle.id,
      source: (SOURCES as string[]).includes(trigger.source) ? (trigger.source as TriggerSource) : 'management',
      label: trigger.label,
      example: trigger.example,
    })),
    workstreams: bundle.work.workstreams.map((stream) => ({
      id: stream.id,
      orgId: bundle.id,
      triggerId: stream.triggerId,
      outcome: stream.outcome,
      ownerSeatId: stream.ownerSeatId,
      kind: stream.kind,
      stepIds: stream.stepIds,
    })),
    steps: bundle.work.steps.map((step) => ({
      id: step.id,
      workstreamId: step.workstreamId,
      name: step.name,
      level: step.level === 3 || step.level === 4 ? step.level : 2,
      executorSeatId: step.executorSeatId,
      inputs: step.inputs ?? [],
      outputs: step.outputs ?? [],
      checkpointId: step.checkpointId,
    })),
    handoffs: bundle.work.handoffs,
    checkpoints: bundle.work.checkpoints,
    activity: [],
    log: [],
  }
}

function departmentName(org: OrgDocument, id: string): string {
  return org.departments.find((item) => item.id === id)?.name || id
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'ORG'
  return parts.slice(0, 2).map((part) => part[0]!.toUpperCase()).join('')
}
