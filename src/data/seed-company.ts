import type { CompanySeed, Seat, SeatType } from './mock-companies'
import { WORK_TASKS, seats, type SeatId } from './seats'

const ORG = 'seed-team'
const STREAM = 'ws-seed'
const ORDER: SeatId[] = ['founder', 'research', 'writing', 'site', 'ops']

function toSeat(id: SeatId): Seat {
  const source = seats[id]
  const type: SeatType = id === 'founder' ? 'human' : 'bot'
  return {
    id,
    orgId: ORG,
    name: source.name,
    role: id === 'founder' ? 'Founder / PM' : source.canvasMeta,
    type,
    reportsTo: id === 'founder' ? undefined : 'founder',
    curated: true,
    card: {
      owns: [source.purpose],
      may: source.does,
      mustAskBefore: [source.approve],
      doneWhen: [source.now],
    },
    status: 'active',
    stats: type === 'bot' ? { usageCount30d: 0, tasksDone30d: 0, lastActiveAt: '' } : undefined,
    profile: {
      department: id === 'founder' ? 'Founder' : 'Bot seat',
      location: '',
      email: '',
      phone: '',
      startedOn: '2026-10-15',
      bio: source.job,
    },
  }
}

const stepIds = WORK_TASKS.map((task) => task.id)

export const SEED_COMPANY: CompanySeed = {
  org: {
    id: ORG,
    name: 'Your team',
    industry: 'Founder team',
    mock: true,
    tagline: 'Seed demo for the launch',
    mark: 'YT',
    markColor: '#0B1220',
    headcount: '1 person, 4 bots',
    seatIds: ORDER,
    workstreamIds: [STREAM],
  },
  seats: ORDER.map(toSeat),
  triggers: [
    {
      id: 'trigger-seed',
      orgId: ORG,
      source: 'management',
      label: 'Announce the demo',
      example: 'Grok Bot launch · November 07, 2026',
    },
  ],
  workstreams: [
    {
      id: STREAM,
      orgId: ORG,
      triggerId: 'trigger-seed',
      outcome: 'Post + page live',
      ownerSeatId: 'founder',
      kind: 'main',
      stepIds,
    },
  ],
  steps: WORK_TASKS.map((task) => ({
    id: task.id,
    workstreamId: STREAM,
    name: task.title,
    level: 2 as const,
    executorSeatId: task.seatId ?? 'founder',
    inputs: [],
    outputs: [],
    checkpointId: task.id === 'post' ? 'cp-founder' : undefined,
  })),
  handoffs: WORK_TASKS.slice(0, -1).map((task, index) => ({
    id: `hand-${task.id}`,
    fromStepId: task.id,
    toStepId: WORK_TASKS[index + 1]!.id,
  })),
  checkpoints: [
    {
      id: 'cp-founder',
      stepId: 'post',
      rule: 'Nothing gets posted until you say yes.',
      approverSeatId: 'founder',
      required: true,
    },
  ],
  activity: [],
  log: [],
}
