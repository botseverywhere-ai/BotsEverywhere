import type { BotSkill } from '../../server/src/org-files.ts'

const key = (skill: BotSkill) => skill.name.trim().toLowerCase()

/** The skills the bot reported turned on in Grok Bot that are not on the list added here, so each shows once. */
export function skillsInGrok(reported: BotSkill[] | undefined, added: BotSkill[] | undefined): BotSkill[] {
  const here = new Set((added ?? []).map(key).filter(Boolean))
  return (reported ?? []).filter((skill) => key(skill) && !here.has(key(skill)))
}

/**
 * How many skills a bot has: the ones added here, plus the ones it reported in Grok Bot that are not among them. null
 * while it has reported none and none were added: unknown, not zero.
 */
export function skillCount(reported: BotSkill[] | undefined, added: BotSkill[] | undefined): number | null {
  const here = (added ?? []).filter((skill) => key(skill)).length
  if (reported === undefined && here === 0) return null
  return here + skillsInGrok(reported, added).length
}

/**
 * Everything known to be in Grok Bot for a bot: the Connector's reading of its instructions first, then any skill the
 * bot itself reports using that the reading does not name, each once. Undefined when neither has said anything yet.
 */
export function knownInGrok(fromBlock: BotSkill[] | undefined, reported: BotSkill[] | undefined): BotSkill[] | undefined {
  if (fromBlock === undefined && reported === undefined) return undefined
  return [...(fromBlock ?? []), ...skillsInGrok(reported, fromBlock)]
}
