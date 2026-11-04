/** Fields that must be filled before Hire is enabled. Whitespace does not count. */
export function missingCardFields(card: {
  owns: string
  may: string
  mustAskBefore: string
  doneWhen: string
}): string[] {
  const missing: string[] = []
  if (!card.owns.trim()) missing.push('Owns')
  if (!card.may.trim()) missing.push('May')
  if (!card.mustAskBefore.trim()) missing.push('Needs approval')
  if (!card.doneWhen.trim()) missing.push('Done when')
  return missing
}
