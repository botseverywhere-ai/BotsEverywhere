export type WriterProbe = 'unknown' | 'up' | 'down'

/** Whether Hire into team can open the drawer for one directory bot. */
export function directoryHireState(input: {
  sample: boolean
  writer: WriterProbe
  alreadySeated: boolean
  name: string
}): { enabled: boolean; reason: string } {
  if (input.sample) {
    return { enabled: false, reason: 'Open your own org to hire this bot.' }
  }
  if (input.writer === 'down') {
    return { enabled: false, reason: 'Saving is off. Restart npm run dev, then hire this bot.' }
  }
  if (input.alreadySeated) {
    return { enabled: false, reason: `${input.name} is already on your org chart.` }
  }
  return { enabled: true, reason: '' }
}
