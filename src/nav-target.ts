import { APP_MODE } from './mode'
import { userOrgs } from './org/load'

import { REPO_URL } from './repo-url'

const repo = REPO_URL

export function mainCta(): { href: string; label: string } {
  if (APP_MODE === 'showcase') return { href: repo || '#docs', label: 'Get it on GitHub' }
  if (userOrgs.length === 1) return { href: `#/org/${userOrgs[0]!.id}/overview`, label: 'Open your org' }
  return { href: '#/orgs', label: 'Open your org' }
}
