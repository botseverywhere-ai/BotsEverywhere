import { grokSyncClass } from './sync-copy.ts'

/** Where a bot seat came from: hired from the directory, imported from Grok Bot, or added by hand with Add a seat. */
export type BotOrigin = 'directory' | 'imported' | 'manual'

export const IMPORTED_NOTE = 'This seat is not in the directory. It was imported from Grok Bot.'
export const INSTRUCTIONS_LABEL = 'Instructions for Grok Bot'
export const INSTRUCTIONS_PLACEHOLDER = 'What this bot should do, in your words…'

/** What Profile shows for one bot. Profile is how the bot works; the Seat card is its place in the organization. */
export interface ProfileParts {
  note: string
  /** none: Grok Bot owns the prompt. directory: the directory prompt, editable after hiring. instructions: typed by hand. */
  prompt: 'none' | 'directory' | 'instructions'
  /** An imported bot's skills and routines come from Grok Bot, so they are shown, not edited. */
  listsEditable: boolean
  /** A bot added by hand and not in Grok Bot yet can be sent there from Profile. */
  addToGrok: boolean
}

export function profileParts(seat: { origin?: BotOrigin; grokSync?: 'new' | 'synced' | 'missing'; grokBotUrl?: string | null }): ProfileParts {
  if (seat.origin === 'imported') return { note: IMPORTED_NOTE, prompt: 'none', listsEditable: false, addToGrok: false }
  if (seat.origin === 'directory') return { note: '', prompt: 'directory', listsEditable: true, addToGrok: false }
  return { note: '', prompt: 'instructions', listsEditable: true, addToGrok: grokSyncClass({ grokSync: seat.grokSync, grokBotUrl: seat.grokBotUrl ?? '' }) !== 'is-in-grok' }
}

/** The prompt to store. An unedited directory prompt is not stored, so the directory stays its source. */
export function promptToSave(edited: string, directoryPrompt: string): string {
  const text = edited.trim()
  return text === directoryPrompt.trim() ? '' : text
}

/** Skill or routine rows as Profile saves them: trimmed, empty fields dropped, and a row without a name left out. */
export function draftRows<T extends { name: string }>(rows: T[]): T[] {
  return rows.flatMap((row) => {
    const kept: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text) kept[key] = text
    }
    return kept.name ? [kept as unknown as T] : []
  })
}
