import type { Seat, Step } from '../data/mock-companies.ts'

export const OPEN_SEAT_PREFIX = 'open:'

export function isOpenSeatId(id: string): boolean {
  return id.startsWith(OPEN_SEAT_PREFIX)
}

export function stepIdFromOpenSeat(id: string): string {
  return id.slice(OPEN_SEAT_PREFIX.length)
}

/** A step with no active executor. Retired executors count as unstaffed. */
export function isUnstaffedStep(step: { executorSeatId: string }, seats: { id: string; status?: string }[]): boolean {
  const seat = seats.find((item) => item.id === step.executorSeatId)
  return !seat || seat.status === 'retired'
}

/**
 * Empty org-chart nodes for unstaffed work steps. They hang under the top human
 * and exist only for the chart; they are not written to the org files.
 */
export function openOrgSeats(steps: Step[], seats: Seat[], orgId: string): Seat[] {
  const active = seats.filter((seat) => seat.status !== 'retired')
  // You first, like a new seat's default manager; never just the first person by file name.
  const root = active.find((seat) => seat.type === 'human' && (seat.id === 'you' || seat.name.trim().toLowerCase() === 'you'))
    ?? active.find((seat) => seat.type === 'human' && !seat.reportsTo)
    ?? active.find((seat) => seat.type === 'human')
  return steps.filter((step) => isUnstaffedStep(step, seats)).map((step) => ({
    id: `${OPEN_SEAT_PREFIX}${step.id}`,
    orgId,
    name: 'Open seat',
    role: step.name,
    type: 'bot',
    reportsTo: root?.id,
    curated: true,
    card: { owns: [], may: [], mustAskBefore: [], doneWhen: [] },
  }))
}
