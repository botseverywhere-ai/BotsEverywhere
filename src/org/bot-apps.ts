import type { AccountApp } from '../../server/src/grok-sync.ts'
import type { AppUse } from '../../server/src/routine-board-types.ts'

/**
 * The apps a bot uses, for Performance: what the bot itself reported in its profile when it has sent one (an empty list
 * is none), else what the Connector read onto its seat from Grok Bot.
 */
export function appsShown(reported: AppUse[] | undefined, seatApps: string[] | undefined): AppUse[] {
  if (reported) return reported
  return (seatApps ?? []).map((name) => ({ name }))
}

/** unknown: the account's list does not name the app, or the Connector has not reported the account's apps yet. */
export type BotAppStatus = AccountApp['status'] | 'unknown'

/** Shown beside an app Grok Bot wants signed in again. */
export const NEEDS_SIGN_IN = 'needs sign-in in Grok Bot'

/**
 * What a bot is connected to. Apps belong to the whole Grok Bot account, so every bot can use each one: the account's
 * apps, connected ones first, then the ones Grok Bot wants signed in again.
 */
export function connectedApps(account: AccountApp[] | undefined): { name: string; status: BotAppStatus }[] {
  const apps = account ?? []
  return [...apps.filter((app) => app.status === 'connected'), ...apps.filter((app) => app.status !== 'connected')].map((app) => ({ name: app.name, status: app.status }))
}

/** A bot's apps, each with the account's status for that name, matched without regard to case. */
export function botApps(apps: string[] | undefined, account: AccountApp[] | undefined): { name: string; status: BotAppStatus }[] {
  const byName = new Map((account ?? []).map((app) => [app.name.toLowerCase(), app.status]))
  return (apps ?? []).map((name) => ({ name, status: byName.get(name.toLowerCase()) ?? 'unknown' }))
}
