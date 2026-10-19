import { SNAPSHOT_FORMAT, SNAPSHOT_PATH } from '../../server/src/connector-prompt.ts'

/** The file the Connector writes. The one-off prompt asks Grok Bot to save the same file by hand. */
export const SNAPSHOT_FILE_NAME = 'snapshot.json'

/** Paste this into a Grok Bot chat when the Connector cannot write the snapshot itself. The format is the sync contract. */
export function grokSnapshotPrompt(folder: string): string {
  const path = folder.trim() || 'orgs/<slug>'
  return `List every bot I run in Grok Bot, including yourself, and every routine they run. Leave out any bot named "Connector - BotsEverywhere" or "Connector - BotsEverywhere (…)". Reply with one JSON object and nothing else. If you can write files on this computer, save it to ${path}/${SNAPSHOT_PATH}.

Use exactly this format:

${SNAPSHOT_FORMAT}`
}

export const GROK_SNAPSHOT_PROMPT = grokSnapshotPrompt('orgs/<slug>')

export const SYNC_NOW_PROMPT = 'Run the Connector - BotsEverywhere routine now and write the snapshot.'

/** The same message for this copy's Connector, by its full name. */
export function syncNowPrompt(connectorName: string): string {
  return connectorName ? `Run the ${connectorName} routine now and write the snapshots.` : SYNC_NOW_PROMPT
}
