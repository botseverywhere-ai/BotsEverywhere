import type { OrgTab } from '../routing'

/** Select value for the last item. It is not an org slug. */
export const NEW_COMPANY = '__new__'

export function orgSwitchHref(slug: string, tab: OrgTab): string {
  return `#/org/${slug}/${tab}`
}

export function newCompanyHref(slug: string): string {
  return `#/org/${slug}/overview`
}
