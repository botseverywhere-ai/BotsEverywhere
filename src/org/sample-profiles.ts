import type { OrgProfile } from '../../server/src/org-files.ts'

const profiles = new Map<string, OrgProfile>()

export function rememberSampleProfile(id: string, profile: OrgProfile) {
  profiles.set(id, profile)
}

export function rememberedSampleProfile(id: string): OrgProfile | null {
  return profiles.get(id) ?? null
}
