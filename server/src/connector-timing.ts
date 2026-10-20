/** The Connector runs every 15 minutes unless orgs/project.json sets another interval. */
export const DEFAULT_SYNC_MINUTES = 15
export const MIN_SYNC_MINUTES = 15
export const MAX_SYNC_MINUTES = 7 * 24 * 60

/** Two missed runs mean it stopped. Shared by the status bar and the logs. */
export function staleMinutes(syncMinutes = DEFAULT_SYNC_MINUTES): number {
  return 2 * syncMinutes
}

export const CONNECTOR_STALE_MINUTES = staleMinutes()
export const CONNECTOR_STALE_MS = CONNECTOR_STALE_MINUTES * 60_000

/** A whole number of minutes in range, or null. */
export function validSyncMinutes(value: unknown): number | null {
  const minutes = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isInteger(minutes) || minutes < MIN_SYNC_MINUTES || minutes > MAX_SYNC_MINUTES) return null
  return minutes
}

/** "15 minutes", "hour", "2 hours", "day": read after "every". */
export function everyLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'day' : `${minutes / 1440} days`
  if (minutes % 60 === 0) return minutes === 60 ? 'hour' : `${minutes / 60} hours`
  return `${minutes} minutes`
}

export type SyncUnit = 'minutes' | 'hours' | 'days'

const UNIT_MINUTES: Record<SyncUnit, number> = { minutes: 1, hours: 60, days: 1440 }

/** The number and unit the interval field shows: the largest unit that divides it. */
export function splitSyncMinutes(minutes: number): { amount: number; unit: SyncUnit } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'days' }
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' }
  return { amount: minutes, unit: 'minutes' }
}

export function joinSyncMinutes(amount: string, unit: SyncUnit): number {
  const value = Number(amount.trim())
  return Number.isFinite(value) && amount.trim() !== '' ? value * UNIT_MINUTES[unit] : NaN
}
