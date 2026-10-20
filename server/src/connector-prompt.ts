import { DEFAULT_SYNC_MINUTES, everyLabel } from './connector-timing.ts'

export const CONNECTOR_BOT_NAME = 'Connector - BotsEverywhere'
export const CONNECTOR_LOG_BOT = 'Connector'
/** The one file Grok Bot overwrites inside the org folder. The app only reads it. */
export const SNAPSHOT_PATH = 'grok/snapshot.json'
/** The app writes this list of bots to create, and retired bots to delete, in Grok Bot. The Connector only reads it. */
export const REQUESTS_FILE = 'grok/requests.json'

/** The snapshot contract, in Grok Bot's words. Shared by the Connector prompt and the one-off prompt. */
export const SNAPSHOT_FORMAT = `{
  "syncedAt": "ISO datetime of now",
  "bots": [
    {
      "name": "Bot name",
      "grokBotUrl": "the bot's Grok Bot link (grokbot://... is fine), or leave it out",
      "reportsTo": "name of the bot or person it reports to, or You",
      "owns": ["what this bot is responsible for"],
      "may": ["what it can do without asking"],
      "needsApproval": ["what it must ask me before doing"],
      "doneWhen": "one sentence on what finished looks like",
      "createdAt": "YYYY-MM-DD",
      "lastActive": "ISO datetime",
      "runs30d": 0,
      "tasksDone30d": 0,
      "routines": [{ "name": "routine name", "schedule": "schedule or trigger", "lastRun": "ISO datetime" }],
      "status": "active"
    }
  ],
  "processes": [
    {
      "name": "routine name",
      "trigger": { "type": "schedule", "schedule": "Mon 09:00", "description": "" },
      "steps": [{ "seat": "bot or person who does this step", "action": "short line" }],
      "doneWhen": "one sentence",
      "next": "name of the routine this hands off to, or leave it out"
    }
  ]
}

Rules:
- One entry per bot, using each bot's real name. One entry per routine.
- owns, may, and needsApproval are lists of short strings. doneWhen is one string.
- Include only what you can actually see. If you do not know a value, leave the field out. Never estimate or invent numbers.
- trigger.type is schedule, event, or manual. For event, set source to email, slack, github, webhook, or form.
- Do not add fields that are not in this object.`

/** One Connector per copy of BotsEverywhere. The id tells copies apart in Grok Bot. */
export function connectorName(id: string): string {
  return id ? `${CONNECTOR_BOT_NAME} (${id})` : CONNECTOR_BOT_NAME
}

/** Built when the person copies it, from the orgs folder of the copy that is running. */
export function connectorPrompt({ id, orgsFolder, syncMinutes = DEFAULT_SYNC_MINUTES }: { id: string; orgsFolder: string; syncMinutes?: number }): string {
  const name = connectorName(id)
  const path = orgsFolder.trim() || '<project folder>/orgs'
  return `Create a bot named ${name}.

This is the only folder you and BotsEverywhere use to exchange files:
${path}

Every folder in ${path} that contains an org.md file is one organization. Its name is the "name" line at the top of that org.md. Below, <org> means one of those folders. Never read or write any file outside ${path}.

Run this routine every ${everyLabel(syncMinutes)}.

On each run, for every organization:
1. If <org>/${REQUESTS_FILE} exists, read it. For each entry in "requests" that Grok Bot does not have yet, create that bot in Grok Bot named exactly as "name". Never create a second bot with a name you already run; use the one you have. When "promptFile" is set, use the text of that file below its frontmatter as the bot's prompt. Otherwise build the prompt from the Owns, May, Needs approval, and Done when sections of the file in "seatFile". That bot belongs to this organization. For each entry in "deletes", delete the bot in Grok Bot whose link is exactly "grokBotUrl". If no bot has that link, do nothing. Never delete a bot by its name alone, and never delete yourself.
2. Write <org>/${SNAPSHOT_PATH} with the bots that belong to this organization and every routine they run, in the snapshot format below. A bot belongs to an organization when you created it from that organization's requests, when its link matches a seat file there, or when its name matches a seat title there, or "Title · Organization name". One Grok Bot account runs every bot, and the same bot can belong to several organizations: list it in every organization it belongs to. Do not list yourself.
3. Read <org>/org.md, every file in <org>/seats/, and every file in <org>/processes/.
4. For each process, create or update a Grok Bot routine for the owning bot (the seat on the first step) using that process trigger.
5. Read reportsTo in each seat file and tell that bot who its manager is in this organization. A bot in several organizations has a manager in each one.
6. Tell each bot that at the start of every run it must read its process file and its seat file.
7. After each step, that bot appends one line to <org>/log/YYYY-MM-DD.md. If the file is missing, start it with the header "# Run log YYYY-MM-DD". Use this line and nothing else:
- HH:MM | bot | process | step | done|failed|skipped|waiting|running | note or -
8. Before any checkpoint, write status waiting and ask the owner before continuing.
9. Append your own sync lines to that organization's log. The bot field on those lines is ${CONNECTOR_LOG_BOT}.
10. When a process file changes, update that bot's routine.

Then, once per run:
11. Write ${path}/connector.json with "syncedAt" (ISO datetime of now), "syncMinutes": ${syncMinutes} (how often you run, in minutes), and "unassigned": every bot you run that belongs to no organization, in the same bot format as the snapshot.

Write every file as UTF-8 without a byte-order mark and with LF line endings.

Never edit org.md, seats/, processes/, work-chart.md, ${REQUESTS_FILE}, or project.json. The app owns those files. You only overwrite <org>/${SNAPSHOT_PATH} and ${path}/connector.json, and append to <org>/log/.

Snapshot format:

${SNAPSHOT_FORMAT}`
}

export function logInstructions(folder: string, processFile: string, seatFile: string): string[] {
  const path = folder.trim() || 'orgs/<slug>'
  return [
    `Before each run, read ${path}/${processFile} and ${path}/${seatFile}.`,
    `After each step, append one line to ${path}/log/YYYY-MM-DD.md. If the file is missing, start it with "# Run log YYYY-MM-DD".`,
    '- HH:MM | your name | process | step | done|failed|skipped|waiting|running | note or -',
    'Before a checkpoint, write waiting and ask the owner before you continue.',
  ]
}
