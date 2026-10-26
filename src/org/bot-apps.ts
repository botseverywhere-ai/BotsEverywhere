import type { AccountApp } from '../../server/src/grok-sync.ts'

/** unknown: the account's list does not name the app, or the Connector has not reported the account's apps yet. */
export type BotAppStatus = AccountApp['status'] | 'unknown'

/** Shown beside an app Grok Bot wants signed in again. */
export const NEEDS_SIGN_IN = 'needs sign-in in Grok Bot'

/** A bot's apps, each with the account's status for that name, matched without regard to case. */
export function botApps(apps: string[] | undefined, account: AccountApp[] | undefined): { name: string; status: BotAppStatus }[] {
  const byName = new Map((account ?? []).map((app) => [app.name.toLowerCase(), app.status]))
  return (apps ?? []).map((name) => ({ name, status: byName.get(name.toLowerCase()) ?? 'unknown' }))
}
