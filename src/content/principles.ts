/**
 * Bot-hiring principles. Static copy only: not fetched, not edited, not stored in org files.
 * The credit names the source. It does not say that author endorses this product.
 */

export const PRINCIPLES = [
  {
    id: 'seat-card',
    label: 'Seat card first',
    text: 'Seat card first: Owns / May / Needs approval / Done when, before any hire.',
  },
  {
    id: 'one-job',
    label: 'One job per bot',
    text: 'One job per bot.',
  },
  {
    id: 'finished-work',
    label: 'Finished work, not chat',
    text: 'Return finished work, not chat.',
  },
  {
    id: 'must-ask',
    label: 'Needs approval',
    text: 'Needs approval: send, post, spend, merge, deploy, DNS, secrets, delete, new access.',
  },
  {
    id: 'least',
    label: 'Least privilege',
    text: 'Least privilege.',
  },
  {
    id: 'never-invent',
    label: 'Never invent',
    text: 'Never invent.',
  },
  {
    id: 'stay-in-lane',
    label: 'Stay in lane',
    text: 'Stay in lane.',
  },
] as const

export const CREDIT = {
  text: 'Principles adapted from How to Hire Your First AI Employee (@distortgeekin)',
  short: 'Adapted from @distortgeekin',
  url: 'https://x.com/distortgeekin/status/2105275395901726845',
} as const

/** Line on an unstaffed or empty seat. Shorter than principle 1: no "before any hire." */
export const UNSTAFFED_LINE = 'Seat card first: Owns / May / Needs approval / Done when.'

/** Rules shown in the hire drawer, in this order. */
export const DRAWER_RULE_IDS = ['seat-card', 'one-job', 'must-ask', 'least'] as const

/** Middot with a space on each side, as in the hiring-rules strip. */
export const PRINCIPLE_SEPARATOR = ' · '

const ABSOLUTE_MUST_ASK = ['send', 'post', 'spend', 'merge', 'deploy', 'dns', 'secrets', 'delete', 'new access'] as const

const CARD_SECTIONS = [
  ['owns', 'Owns'],
  ['may', 'May'],
  ['mustAskBefore', 'Needs approval'],
  ['doneWhen', 'Done when'],
] as const

export type DrawerRuleStatus = 'met' | 'open' | 'guide'

export function mustAskCoversAbsolute(text: string): boolean {
  const hay = text.toLowerCase()
  return ABSOLUTE_MUST_ASK.every((term) => hay.includes(term))
}

export function sectionHasLine(value: string): boolean {
  return value.split('\n').some((line) => line.trim().length > 0)
}

export function firstEmptySection(values: { owns: string; may: string; mustAskBefore: string; doneWhen: string }): string | null {
  for (const [key, label] of CARD_SECTIONS) {
    if (!sectionHasLine(values[key])) return label
  }
  return null
}

export function emptyHireTitle(section: string | null): string | undefined {
  return section ? `${section} is empty. No card, no hire.` : undefined
}

export function drawerRuleStatus(
  id: (typeof PRINCIPLES)[number]['id'],
  input: { owns: string; may: string; mustAskBefore: string; doneWhen: string; acknowledged: boolean },
): DrawerRuleStatus {
  if (id === 'one-job' || id === 'least') return 'guide'
  if (id === 'seat-card') return firstEmptySection(input) === null ? 'met' : 'open'
  if (id === 'must-ask') return input.acknowledged || mustAskCoversAbsolute(input.mustAskBefore) ? 'met' : 'open'
  return 'guide'
}

export function drawerRules() {
  return DRAWER_RULE_IDS.map((id) => PRINCIPLES.find((item) => item.id === id)! )
}
