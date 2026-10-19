import type { CompanySeed, LogEvent, Seat, Step } from '../data/mock-companies.ts'

export interface SessionState {
  hired: Seat[]
  retiredAt: Record<string, string>
  restored: string[]
  unstaffed: string[]
  executors: Record<string, string>
  extraLog: LogEvent[]
}

export const EMPTY_SESSION: SessionState = {
  hired: [],
  retiredAt: {},
  restored: [],
  unstaffed: [],
  executors: {},
  extraLog: [],
}

function isActiveSeat(company: CompanySeed, session: SessionState, seatId: string): boolean {
  if (!seatId) return false
  if (session.retiredAt[seatId]) return false
  if (session.restored.includes(seatId)) return true
  const seat = company.seats.find((item) => item.id === seatId) ?? session.hired.find((item) => item.id === seatId)
  return Boolean(seat && seat.status !== 'retired')
}

/**
 * Newest active assignment wins. A session hire on the step is staffed before
 * the "original executor is retired" check. A step stays unstaffed when its
 * latest assignment was retired, until that seat is restored and no newer
 * active hire holds the step.
 */
export function stepsNow(company: CompanySeed, session: SessionState): Step[] {
  return company.steps.map((step) => {
    const assigned = session.executors[step.id]
    if (assigned && isActiveSeat(company, session, assigned)) {
      return { ...step, executorSeatId: assigned, staffing: 'staffed' as const }
    }
    if (session.unstaffed.includes(step.id) || !isActiveSeat(company, session, step.executorSeatId)) {
      return { ...step, staffing: 'unstaffed' as const }
    }
    return step
  })
}

export function commitHire(
  company: CompanySeed,
  session: SessionState,
  seat: Seat,
  stepIds: string[],
  actorSeatId: string,
  now: string,
): SessionState {
  const event: LogEvent = {
    id: `${seat.id}-hire`,
    orgId: company.org.id,
    type: 'hire',
    actorSeatId,
    actorType: 'human',
    timestamp: now,
    summary: `Hired ${seat.name} as ${seat.role}.`,
    subjectSeatId: seat.id,
    stepId: stepIds[0],
    status: 'done',
  }
  return {
    ...session,
    hired: [...session.hired, seat],
    unstaffed: session.unstaffed.filter((stepId) => !stepIds.includes(stepId)),
    executors: { ...session.executors, ...Object.fromEntries(stepIds.map((stepId) => [stepId, seat.id])) },
    extraLog: [event, ...session.extraLog],
  }
}

export function commitRetire(
  company: CompanySeed,
  session: SessionState,
  seat: Seat,
  reason: string,
  actorSeatId: string,
  now: string,
): SessionState {
  const openSteps = stepsNow(company, session)
    .filter((step) => step.executorSeatId === seat.id && step.staffing !== 'unstaffed')
    .map((step) => step.id)
  const executors = { ...session.executors }
  for (const stepId of openSteps) delete executors[stepId]
  const event: LogEvent = {
    id: `${seat.id}-retire-${now}`,
    orgId: company.org.id,
    type: 'fire',
    actorSeatId,
    actorType: 'human',
    timestamp: now,
    summary: reason.trim() ? `Retired ${seat.name}. ${reason.trim()}` : `Retired ${seat.name}.`,
    subjectSeatId: seat.id,
    stepId: openSteps[0],
    status: 'done',
  }
  return {
    ...session,
    retiredAt: { ...session.retiredAt, [seat.id]: now },
    restored: session.restored.filter((id) => id !== seat.id),
    unstaffed: [...new Set([...session.unstaffed, ...openSteps])],
    executors,
    extraLog: [event, ...session.extraLog],
  }
}

export function commitRestore(company: CompanySeed, session: SessionState, seat: Seat): SessionState {
  const retiredAt = Object.fromEntries(Object.entries(session.retiredAt).filter(([id]) => id !== seat.id))
  const restored = seat.status === 'retired' && !session.restored.includes(seat.id)
    ? [...session.restored, seat.id]
    : session.restored
  const next = { ...session, retiredAt, restored }
  const unstaffed = session.unstaffed.filter((stepId) => {
    const step = company.steps.find((item) => item.id === stepId)
    if (!step || step.executorSeatId !== seat.id) return true
    const newer = session.executors[stepId]
    if (newer && newer !== seat.id && isActiveSeat(company, next, newer)) return true
    return false
  })
  return { ...next, unstaffed }
}
