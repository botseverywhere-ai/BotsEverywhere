import type { AccountApp } from '../../server/src/grok-sync.ts'
import { connectedApps } from '../org/bot-apps'

/**
 * The apps connected to the Grok Bot account, as badges. Apps belong to the whole account, so every bot can use each one;
 * one Grok Bot wants signed in again says so. Shown once on Performance and in each bot's Profile.
 */
export function AccountApps({ apps }: { apps?: AccountApp[] }) {
  const rows = connectedApps(apps)
  if (!rows.length) return null
  return (
    <div className="account-apps">
      <strong>Connected to your Grok Bot account:</strong>
      <ul>
        {rows.map((app) => (
          <li key={app.name} className={app.status === 'needsAuth' ? 'app-badge is-needs-auth' : 'app-badge is-connected'}>{app.name}{app.status === 'needsAuth' ? ' (needs sign-in)' : ''}</li>
        ))}
      </ul>
    </div>
  )
}
