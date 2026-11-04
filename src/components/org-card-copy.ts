import type { Seat } from '../data/mock-companies'

/** Chart subtitle for a bot: description, else the first Owns line, else a role that is not the name. */
export function botBlurb(seat: Pick<Seat, 'name' | 'role' | 'card'> & { description?: string }): string {
  const described = seat.description?.trim() ?? ''
  if (described) return described
  const owns = seat.card.owns.find((line) => line.trim())?.trim() ?? ''
  if (owns) return owns
  const role = seat.role.trim()
  if (role && role.toLowerCase() !== seat.name.trim().toLowerCase()) return role
  return ''
}

/** Task count on an org-chart card. Live log metrics win over the hire and retire events. */
export function taskNote(seat: Pick<Seat, 'id' | 'stats' | 'shown'>, leastUsedId: string | undefined, sampleUsage: boolean): string {
  const tasks = seat.shown ? seat.shown.tasks ?? 0 : seat.stats?.tasksDone30d ?? 0
  const parts = [`${tasks} tasks/30d`]
  if (seat.id === leastUsedId) parts.push('Least used')
  if (sampleUsage) parts.push('sample')
  return parts.join(' · ')
}

/** Accessible name for an org-chart card. Does not repeat the bot name as its role. */
export function orgCardLabel(seat: Pick<Seat, 'name' | 'role' | 'type' | 'card'> & { description?: string }): string {
  const detail = seat.type === 'bot' ? botBlurb(seat) : seat.role.trim()
  const name = seat.name.trim()
  if (detail && detail.toLowerCase() !== name.toLowerCase()) return `${seat.name}, ${detail}, ${seat.type}`
  return `${seat.name}, ${seat.type}`
}
