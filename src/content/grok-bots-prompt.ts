/** Shared by the bots file import and export on Connect bots. */

/** The IANA time zone of the computer showing the page, from its operating system. Empty when the browser cannot say. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

export const BOTS_FILE_NAME = 'botseverywhere-bots.json'
