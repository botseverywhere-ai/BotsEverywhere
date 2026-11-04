export type Role = 'owner' | 'editor' | 'viewer'
export type ShareLevel = 'edit' | 'view'

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'editor' || value === 'viewer'
}

export function canReadTeam(input: { isSample: boolean; role: Role | null; share?: ShareLevel | null }): boolean {
  return input.isSample || input.share === 'edit' || input.share === 'view' || input.role !== null
}

/** Edit links, editors, and owners change seats. A view link alone cannot. The sample team never can. */
export function canEditSeats(input: { isSample: boolean; role: Role | null; share?: ShareLevel | null }): boolean {
  if (input.isSample) return false
  if (input.share === 'edit') return true
  if (input.role === null) return false
  return input.role === 'owner' || input.role === 'editor'
}

/** Edit links and owners can rename. A view link, editor, or viewer cannot. */
export function canRenameTeam(input: { isSample: boolean; role: Role | null; share?: ShareLevel | null }): boolean {
  if (input.isSample) return false
  return input.share === 'edit' || input.role === 'owner'
}

/** Only the current edit link can revoke and replace both links. */
export function canRegenerateLinks(input: { isSample: boolean; share?: ShareLevel | null }): boolean {
  return !input.isSample && input.share === 'edit'
}

/** Owners rename the team and manage members. Viewers and editors cannot. */
export function canManageTeam(input: { isSample: boolean; role: Role | null }): boolean {
  return !input.isSample && input.role === 'owner'
}
