import type { SeatRecord, WorkChart } from '../api'
import type { CompanySeed, Seat, SeatType, StepLevel, TriggerSource } from './mock-companies'

const SOURCES: TriggerSource[] = ['email', 'chat', 'meeting', 'dashboard', 'customer', 'alert', 'management', 'schedule']

function asSource(value: string): TriggerSource {
  return (SOURCES as string[]).includes(value) ? (value as TriggerSource) : 'management'
}

function lines(value?: string): string[] {
  if (!value?.trim()) return []
  return value.split(/\n+/).map((item) => item.trim()).filter(Boolean)
}

function level(value: number): StepLevel {
  if (value === 3 || value === 4) return value
  return 2
}

export function companyFromTeam(teamId: string, name: string, records: SeatRecord[], work: WorkChart | null): CompanySeed {
  const seats: Seat[] = records.map((record) => {
    const type: SeatType = record.kind ?? (record.botSlug ? 'bot' : 'human')
    return {
      id: record.id,
      orgId: teamId,
      name: record.name,
      role: record.role || (type === 'human' ? 'Human' : 'Bot'),
      type,
      reportsTo: record.reportsTo || undefined,
      curated: true,
      card: {
        owns: lines(record.owns),
        may: lines(record.may),
        mustAskBefore: lines(record.mustAskBefore),
        doneWhen: lines(record.doneWhen),
      },
      provenance: record.provenance,
      status: 'active',
      stats: type === 'bot' ? { usageCount30d: 0, tasksDone30d: 0, lastActiveAt: '' } : undefined,
      profile: {
        department: record.role,
        location: '',
        email: '',
        phone: '',
        startedOn: '',
        bio: record.humanOwner ? `Human owner: ${record.humanOwner}` : record.name,
      },
    }
  })
  const owner = seats.find((seat) => seat.type === 'human') ?? seats[0]

  if (work && work.steps.length > 0 && work.workstreams.length > 0) {
    const workstreams = work.workstreams.map((stream) => ({
      id: stream.id,
      orgId: teamId,
      triggerId: `trigger-${stream.id}`,
      outcome: stream.outcome,
      ownerSeatId: stream.ownerSeatId || owner?.id || '',
      kind: stream.kind === 'contingency' ? ('contingency' as const) : ('main' as const),
      stepIds: work.steps
        .filter((step) => step.workstreamId === stream.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((step) => step.id),
    }))
    return {
      org: {
        id: teamId,
        name: name || 'Your team',
        industry: 'Private team',
        mock: false,
        seatIds: seats.map((seat) => seat.id),
        workstreamIds: workstreams.map((stream) => stream.id),
      },
      seats,
      triggers: work.workstreams.map((stream) => ({
        id: `trigger-${stream.id}`,
        orgId: teamId,
        source: asSource(stream.triggerSource),
        label: stream.triggerLabel || stream.outcome,
        example: stream.triggerLabel || stream.outcome,
      })),
      workstreams,
      steps: work.steps.map((step) => ({
        id: step.id,
        workstreamId: step.workstreamId,
        name: step.name,
        level: level(step.level),
        executorSeatId: step.executorSeatId,
        inputs: [],
        outputs: [],
        checkpointId: work.checkpoints.find((item) => item.stepId === step.id)?.id,
      })),
      handoffs: work.handoffs.map((item) => ({
        id: item.id,
        fromStepId: item.fromStepId,
        toStepId: item.toStepId,
      })),
      checkpoints: work.checkpoints.map((item) => ({
        id: item.id,
        stepId: item.stepId,
        rule: item.rule,
        approverSeatId: item.approverSeatId,
        required: item.required,
      })),
      activity: [],
    }
  }

  const streamId = `${teamId}-work`
  const stepList = seats.map((seat, index) => ({
    id: `${teamId}-step-${seat.id}`,
    workstreamId: streamId,
    name: seat.name,
    level: 2 as const,
    executorSeatId: seat.id,
    inputs: [] as string[],
    outputs: [] as string[],
    checkpointId: index === seats.length - 1 && owner ? `${teamId}-cp` : undefined,
  }))
  return {
    org: {
      id: teamId,
      name: name || 'Your team',
      industry: 'Private team',
      mock: false,
      seatIds: seats.map((seat) => seat.id),
      workstreamIds: [streamId],
    },
    seats,
    triggers: [
      {
        id: `${teamId}-trigger`,
        orgId: teamId,
        source: 'management',
        label: name || 'Team work',
        example: 'Work starts with this team.',
      },
    ],
    workstreams: [
      {
        id: streamId,
        orgId: teamId,
        triggerId: `${teamId}-trigger`,
        outcome: 'Human approve',
        ownerSeatId: owner?.id ?? '',
        kind: 'main',
        stepIds: stepList.map((step) => step.id),
      },
    ],
    steps: stepList,
    handoffs: stepList.slice(0, -1).map((step, index) => ({
      id: `${teamId}-hand-${index}`,
      fromStepId: step.id,
      toStepId: stepList[index + 1]!.id,
    })),
    checkpoints: owner
      ? [
          {
            id: `${teamId}-cp`,
            stepId: stepList[stepList.length - 1]?.id ?? '',
            rule: 'Nothing ships until the owner says yes.',
            approverSeatId: owner.id,
            required: true,
          },
        ]
      : [],
    activity: [],
  }
}
