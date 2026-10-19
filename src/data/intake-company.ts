import type { CompanySeed, Seat, SeatType } from './mock-companies'
import { seats, type SeatId } from './seats'

const ORDER: SeatId[] = ['founder', 'research', 'writing', 'site']

export function intakeCompany(trigger: string, example: string): CompanySeed {
  const orgId = `intake-${trigger.toLowerCase()}`
  const streamId = `${orgId}-work`
  const chartSeats: Seat[] = ORDER.map((id) => {
    const source = seats[id]
    const type: SeatType = id === 'founder' ? 'human' : 'bot'
    return {
      id,
      orgId,
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
  })
  const steps = [
    { id: `${orgId}-classify`, name: 'Classify intake', executorSeatId: 'founder' },
    { id: `${orgId}-brief`, name: 'Source-checked brief', executorSeatId: 'research' },
    { id: `${orgId}-post`, name: 'Launch post draft', executorSeatId: 'writing' },
    { id: `${orgId}-page`, name: 'Update landing', executorSeatId: 'site' },
    { id: `${orgId}-approve`, name: 'Founder approve', executorSeatId: 'founder' },
  ]
  return {
    org: {
      id: orgId,
      name: 'Intake team',
      industry: 'Temporary chart',
      mock: true,
      tagline: trigger,
      mark: 'IN',
      markColor: '#111111',
      seatIds: ORDER,
      workstreamIds: [streamId],
    },
    seats: chartSeats,
    triggers: [
      {
        id: `${orgId}-trigger`,
        orgId,
        source: 'management',
        label: trigger,
        example,
      },
    ],
    workstreams: [
      {
        id: streamId,
        orgId,
        triggerId: `${orgId}-trigger`,
        outcome: 'Founder-approved narrative',
        ownerSeatId: 'founder',
        kind: 'main',
        stepIds: steps.map((step) => step.id),
      },
    ],
    steps: steps.map((step) => ({
      id: step.id,
      workstreamId: streamId,
      name: step.name,
      level: 2 as const,
      executorSeatId: step.executorSeatId,
      inputs: [],
      outputs: [],
      checkpointId: step.id.endsWith('-approve') ? `${orgId}-cp` : undefined,
    })),
    handoffs: steps.slice(0, -1).map((step, index) => ({
      id: `${orgId}-hand-${index}`,
      fromStepId: step.id,
      toStepId: steps[index + 1]!.id,
    })),
    checkpoints: [
      {
        id: `${orgId}-cp`,
        stepId: `${orgId}-approve`,
        rule: 'Nothing ships until the founder says yes.',
        approverSeatId: 'founder',
        required: true,
      },
    ],
    activity: [],
    log: [],
  }
}
