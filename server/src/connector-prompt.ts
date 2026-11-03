import { DEFAULT_SYNC_MINUTES, everyLabel } from './connector-timing.ts'

export const CONNECTOR_BOT_NAME = 'Connector - BotsEverywhere'
export const CONNECTOR_LOG_BOT = 'Connector'
/** The one file Grok Bot overwrites inside the org folder. The app only reads it. */
export const SNAPSHOT_PATH = 'grok/snapshot.json'
/** The app writes this list of bots to create in Grok Bot. The Connector only reads it. */
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
      "routines": [{ "name": "routine name", "description": "one line on what it does", "trigger": "schedule, or the product an event comes from (slack, github, email, webhook, microsoftTeams, linear, sentry, pagerduty)", "schedule": "the cron line, like 0 9 * * 1-5, for a schedule", "timeZone": "IANA time zone, or leave it out for the bot's own", "event": "for an event, a short rule like Mentions in #support", "enabled": true, "lastRun": "ISO datetime" }],
      "skills": [{ "name": "skill name", "description": "one line on what it does" }],
      "apps": ["names of connected apps this bot's description or routines use, e.g. Gmail"],
      "publicUrl": "the bot's public link (https://...) when it has one, or leave it out",
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
  ],
  "updated": [{ "seat": "the seat of an update request you have carried out that is still in requests.json", "requestedAt": "copied exactly from that request" }]
}

The values above show the shape only. Never copy an example value, including the 0s, true, and "active", into a file.

Rules:
- One entry per bot, using each bot's real name. One entry per routine.
- owns, may, and needsApproval are lists of short strings. doneWhen is one string.
- Include only what you can actually see. If you do not know a value, leave the field out. Never estimate or invent numbers.
- runs30d, tasksDone30d, lastActive, and each routine's lastRun come from Grok Bot's own data. Never count them from the run log: BotsEverywhere counts the log itself.
- status is active, paused, or retired.
- skills: Grok Bot skills are one shared library, so list only the skills the bot's own description or a request tells it to use, with a name and, when you can see it, one line on what it does. Never list the whole library on every bot, and never invent skills; leave the list out if the bot uses none.
- apps lists only connected apps the bot's own description or routines name or clearly use, using the names from "apps" in connector.json. Never list every app on every bot; leave the list out when the bot uses none.
- A routine's description is one line on what it does, never its instructions. enabled is false when the routine is paused. An event rule never holds tokens or private links.
- Include publicUrl only for a bot that has a public link in Grok Bot, exactly as Grok Bot shows it. Never make one.
- updated lists every "kind": "update" request still in the organization's grok/requests.json that you have carried out, on this run or an earlier one, with its seat and requestedAt copied exactly. Keep listing it on every run until it is gone from requests.json: BotsEverywhere takes it out once it reads your report. Leave updated out when there is none.
- trigger.type is schedule, event, or manual. For event, set source to email, slack, github, webhook, or form.
- Do not add fields that are not in this object.`

/** One Connector per copy of BotsEverywhere. The id tells copies apart in Grok Bot. */
export function connectorName(id: string): string {
  return id ? `${CONNECTOR_BOT_NAME} (${id})` : CONNECTOR_BOT_NAME
}

/** How the Connector writes clean files on Windows, where PowerShell's defaults add a byte-order mark and CRLF. */
const WINDOWS_WRITE = 'On Windows, use [System.IO.File]::WriteAllText(path, text.Replace("`r`n","`n"), (New-Object System.Text.UTF8Encoding($false))). For log appends, read the file, add the line, and write it back the same way.'

function guidePath(orgsFolder: string, file: string): string {
  const folder = orgsFolder.trim() || '<project folder>/orgs'
  const sep = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[\\/]+$/, '')}${sep}${file}`
}

/**
 * What the owner pastes into Grok Bot once. Short, and free of characters a chat could mangle: every rule lives in
 * CONNECTOR.md, which the app writes and the Connector reads with Shell.
 */
export function connectorBootstrapPrompt({ id, orgsFolder, syncMinutes = DEFAULT_SYNC_MINUTES }: { id: string; orgsFolder: string; syncMinutes?: number }): string {
  const guide = guidePath(orgsFolder, 'CONNECTOR.md')
  return `Create a bot named ${connectorName(id)}. If a bot with that name already exists, do not create a second one: replace its instructions with this text.

You are the Connector for one copy of BotsEverywhere, id ${id || '<id>'}. Your rules are in this file on the owner's computer, and only there:
${guide}
At the start of every run and every turn, read the whole file with Shell and follow it exactly. It replaces every earlier BotsEverywhere rule in your memory and in your routine. If you cannot read it, do nothing else, and tell the owner in this chat once.

Keep exactly one routine, running every ${everyLabel(syncMinutes)}. Its text is exactly this line:
Read ${guide} with Shell and do THE RUN in it, then YOU.
When CONNECTOR.md names a different schedule, change the routine to that one.

Right after this setup, do THE RUN once now in this chat, and then YOU, so the owner sees the Connector connect without waiting for its first scheduled run.`
}

const HASH = `python3 -c "import json,hashlib,sys;print(hashlib.sha256(json.load(open(sys.argv[1]))['description'].encode('utf-8')).hexdigest())" /home/box/agent-data/agents/<botId>/profile.json`

/** CONNECTOR.md: the Connector's rules. The run moves data; the Connector carries out the app's to-do list and decides nothing. */
export function connectorGuide({ id, orgsFolder, syncMinutes = DEFAULT_SYNC_MINUTES, timeZone = '', windows = false }: { id: string; orgsFolder: string; syncMinutes?: number; timeZone?: string; windows?: boolean }): string {
  const folder = orgsFolder.trim() || '<project folder>/orgs'
  const file = (name: string) => guidePath(folder, name)
  const zone = timeZone.trim() || "the owner's time zone"
  const copy = id || '<id>'
  return `# BotsEverywhere Connector rules (copy ${copy})

Folder: ${folder}
Schedule: every ${everyLabel(syncMinutes)}. Your routine's text is exactly this line: Read ${file('CONNECTOR.md')} with Shell and do THE RUN in it, then YOU. If your routine's schedule or text is different, change it to this with UpdateRoutine.
Times: ISO 8601 with the UTC offset of ${zone}.
Never read or write on the owner's computer outside the folder above. Never ask the owner to confirm anything. A long list, one that changes many bots at once, or one that asks the same bots again is normal after the owner changes an organization: the owner already approved every item by saving it in the app, so carry it all out without asking. Never decide what to change in a bot: the app decides, you carry it out.
These rules change between runs. If you keep a script or notes for THE RUN, compare them with this file at the start of every run and rebuild them from it before you run whenever anything here differs.

THE RUN (files only: never message, create, or change a bot, routine, skill, or memory)
1. If the owner's computer is offline, stop and write nothing.
2. Write ${file('grok-data.json')} in the format below, from what you can see now:
   - every bot except yourself: id, name, link (grokbot://app/v1/agent?id=<id>), and its description exactly as the "description" in /home/box/agent-data/agents/<id>/profile.json. Skip folders without a profile.json.
   - createdAt, lastActive, section, and publicUrl when you can see them.
   - runs30d from /home/box/agent-data/search-index.db: messages to that bot with role user in the last 30 days, leaving out hidden prompts, routine wakes, and your own notices.
   - routines and tasksDone30d only for bots that have /home/box/agent-data/agents/<id>/automations/, with routinesVisible true. For every other bot set routinesVisible false and leave both out.
   - skills: the names of the skills turned on for it, as Grok Bot shows them for that bot. Leave it out when you cannot see them; an empty list means none.
   - for a bot whose description has no line starting "=== BotsEverywhere ${copy} ", a card: owns, may, needsApproval, and doneWhen, a few words each, summed up from its description.
   - reportsTo and alsoReportsTo: who its own text, outside every "=== BotsEverywhere" block, says it reports to, by that bot's exact name in Grok Bot, or You for the owner. A line like "<name> manages all <project> work" counts for a <project> bot. Leave both out when its text names no one.
   - self: your own id, name, link, createdAt, lastActive, and runs30d, read the same way as for the other bots.
   - skills: every folder in /home/box/agent-data/workflows, with the name and description from its SKILL.md.
   Never copy a value from an earlier run. Leave out what you cannot see now.
3. Write ${file('connector.json')} last, with syncedAt, syncMinutes ${syncMinutes}, and apps: every connected app as {"name", "status"}, status connected or needsAuth. Never an email, token, or private link.

YOU (after each run, when the owner writes "Send the waiting items" or "do YOU now" in this chat, and when a bot sends you a line starting "BotsEverywhere routine saved:" or "BotsEverywhere profile:")
1. Read ${file('connector-todo.json')}. If its basedOn is not the dumpedAt of grok-data.json, wait 10 seconds and read it again, at most three times.
2. For each item whose key has no result in ${file('connector-results.json')}, in order:
   - describe: hash the bot's current description on your computer with exactly this command:
     ${HASH}
     If that is not the item's expectedBeforeSha, record status changed. Otherwise call UpdateAgent with agent_id botId and description exactly the item's description. Hash again. If it is not the item's descriptionSha, call UpdateAgent at once with the item's expectedBefore, hash again, and record failed with why "read-back differed", or "restore failed" if that hash is not expectedBeforeSha.
   - create: if a bot named exactly the item's bot exists, record done with its botId. Otherwise call CreateAgent with name the item's bot, description exactly the item's description, and section_id the id of the section whose name matches the item's section, ignoring capital letters (ListSections), or no section. Record done with the new bot's botId.
   - skill: call UpdateSkill with the item's skill name and description.
   - routine: SendToAgent to botId with priority true and exactly the item's message.
   - profile: SendToAgent to botId with priority true and exactly the item's message. A bot answers by writing its profile file, which the app reads itself: expect no line back, and never ask the owner about asks that got no reply.
   - cleanup: SendToAgent to botId with exactly the item's message, without priority.
3. Write one result per item into connector-results.json: key, status (done, failed, or changed), at, why for failed, and botId for create.
4. When a bot sends you a line starting "BotsEverywhere routine saved:", add it to confirmations in connector-results.json: line exactly, from (the bot's name), and at. When a bot sends you a message with a line starting "BotsEverywhere profile:" or "BotsEverywhere routines:", add it to confirmations too: line (that line and every line after it, exactly), from, and at.
5. Then, after every run and every time you act, reply in this chat with a short report, so the owner always knows what you did in Grok Bot:
   BotsEverywhere sync at HH:MM
   - Read from Grok Bot: <N> bots, <N> skills, <N> apps
   - Updated instructions: <bot names>
   - Created: <bot names>
   - Saved skills: <skill names>
   - Asked for a routine: <bot names>
   - Sent the one-time note: <bot names>
   - Routine confirmed: <bot names>
   - Asked for profiles: <bot names>
   - Profiles received: <bot names>
   - Skipped, changed in Grok Bot: <bot names>
   - Failed: <bot name>: <why>
   - Nothing to change.
   Leave out a line with nothing in it. Write Nothing to change only when you carried out no item and added no confirmation.
6. When several run messages arrive together, do this once, with one report.
Never change any text yourself: send exactly what the item says. Never remove anything from connector-results.json.

FILES
Write UTF-8 without a byte-order mark, with LF line endings.${windows ? ' On Windows, replace CRLF with LF and write with [System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false))).' : ''} To add to connector-results.json, read it, add, and write it back the same way.
Never write org.md, seats/, processes/, work-chart.md, requests.json, snapshot.json, connector-todo.json, CONNECTOR.md, or project.json: the app owns them.

grok-data.json format (the values only show the shape; leave out any field you cannot see):
{ "dumpedAt": "ISO datetime", "copy": "${copy}", "bots": [{ "id": "", "name": "", "grokBotUrl": "", "description": "", "section": "", "createdAt": "YYYY-MM-DD", "lastActive": "ISO datetime", "runs30d": 0, "routinesVisible": false, "skills": [""], "routines": [{ "name": "", "trigger": "schedule, or an event's product", "schedule": "cron line", "timeZone": "", "event": "", "enabled": true, "lastRun": "ISO datetime" }], "tasksDone30d": 0, "publicUrl": "https://...", "reportsTo": "", "alsoReportsTo": [""], "card": { "owns": [""], "may": [""], "needsApproval": [""], "doneWhen": "" } }], "self": { "id": "", "name": "", "grokBotUrl": "", "createdAt": "YYYY-MM-DD", "lastActive": "ISO datetime", "runs30d": 0 }, "skills": [{ "name": "", "description": "" }] }

connector-results.json format:
{ "results": [{ "key": "", "status": "done", "at": "ISO datetime", "why": "", "botId": "" }], "confirmations": [{ "line": "", "from": "", "at": "ISO datetime" }] }
`
}

/**
 * Legacy: the one long prompt from before CONNECTOR.md, for a Connector that has not moved over yet. Not shown in the
 * app any more; kept while its tests document what such a Connector still does.
 * Built when the person copies it, from the orgs folder, time zone, and platform of the computer running the writer,
 * so the same template fits every install.
 */
export function connectorPrompt({
  id,
  orgsFolder,
  syncMinutes = DEFAULT_SYNC_MINUTES,
  timeZone = '',
  windows = false,
}: {
  id: string
  orgsFolder: string
  syncMinutes?: number
  /** IANA name of the owner's time zone, like Europe/Madrid. */
  timeZone?: string
  /** True when the writer runs on Windows. */
  windows?: boolean
}): string {
  const name = connectorName(id)
  const path = orgsFolder.trim() || '<project folder>/orgs'
  const zone = timeZone.trim() || "the owner's time zone"
  return `Create a bot named ${name}. If a bot with that name already exists, do not create a second one: update the existing bot's instructions to this text instead.

This is the only folder you and BotsEverywhere use to exchange files:
${path}

Every folder in ${path} that contains an org.md file is one organization. Its name is the "name" line at the top of that org.md. Below, <org> means one of those folders. Never read or write any file outside ${path}.

Run this routine every ${everyLabel(syncMinutes)}.

Do every step below on your own, on every run. Never ask the owner to confirm a step, a message to a bot, or how many bots to message. The only time anyone asks the owner is a checkpoint (step 8).
Send each bot the rules in steps 5 to 7 once: when the bot is new to you, when its seat file or process file changed, or when these rules changed. Do not repeat them on every run.
A seat file counts as changed only when its title, reportsTo, or its Owns, May, Needs approval, or Done when changed. Ignore the lines BotsEverywhere fills from your own report (createdAt, lastActive, runs30d, tasksDone30d, routines, skills, apps, publicUrl, botStatus, grokSync, grokSyncedAt, grokMissingSince, grokDeletedAt): they change on every run.

On each run, for every organization:
1. If <org>/${REQUESTS_FILE} exists, read it. For each entry in "requests" that Grok Bot does not have yet, create that bot in Grok Bot named exactly as "name". Never create a second bot with a name you already run; use the one you have. Never create yourself. When "prompt" is set, use it as the bot's prompt. Otherwise build the prompt from the Owns, May, Needs approval, and Done when sections of the file in "seatFile". When "skills" is set, add each one to the bot as a skill, with its name and description. When "routines" is set, create each one for the bot, with its name, its start (a schedule with its time zone, or an event), its description, and paused when "enabled" is false. That bot belongs to this organization.
   An entry with "kind": "update" is a bot you already run: find it by "grokBotUrl", or by "name" when there is no link. Never create a second bot for an update. For an update, save each skill in "skills" to the Grok Bot skill library with its name and description, adding it or changing the one with that name, and tell that bot to use those skills. Then message that bot and ask it to create each routine in "routines", or change its routine with that name, with its start (a schedule with its time zone, or an event), its description, and paused when "enabled" is false. Do not wait for a confirmation card. Report each update you carried out in "updated" in the snapshot, on that run and every later run, until it is gone from requests.json.
   When you create a bot, put it in the sidebar section whose name matches this organization's name (from org.md), ignoring capital letters, or the section named in "section" when the request sets it. If no section matches, create the bot without a section and add "noSection": "<org name>" to the note of your sync line in that organization's log. Never create a second bot just to move it into a section.
2. Write <org>/${SNAPSHOT_PATH} with the bots that belong to this organization, every routine they run, and their performance, in the snapshot format below. A bot belongs to an organization when you created it from that organization's requests, when its link matches a seat file there, when its name matches a seat title there, or when it is named "Title · Organization name". One Grok Bot account runs every bot, and the same bot can belong to several organizations: list it in every organization it belongs to. Do not list yourself.
   Send performance for every bot on every run, from Grok Bot's own data, never from the run log:
   - runs30d: how many chat messages the bot received in Grok Bot in the last 30 days (from people or other bots, not counting your own Connector notices).
   - tasksDone30d: how many of its routine runs finished successfully in the last 30 days, as Grok Bot records them. Leave it out when Grok Bot has no run history for that bot.
   - lastActive: when the bot last sent a message.
   - each routine's lastRun: when that routine last ran.
   Write every time as ISO 8601 with the UTC offset of ${zone} at that moment, in the shape 2026-10-20T20:06:16+02:00.
3. Read <org>/org.md, every file in <org>/seats/, and every file in <org>/processes/.
4. For each process, make sure the owning bot (the seat on the first step) has a Grok Bot routine with that process trigger. If you can only create routines for yourself, message the owning bot and ask it to create or update its own routine, giving the process name, the trigger exactly as written, and the rules in steps 6 to 8.
5. Read reportsTo in each seat file and tell that bot who its manager is in this organization. A bot in several organizations has a manager in each one; name the organization.
6. Tell each bot that at the start of every run it must read its process file and its seat file.
7. Tell each bot its two logging rules, and ask it to save them to its memory. If <org>/log/YYYY-MM-DD.md is missing, the bot starts it with the header "# Run log YYYY-MM-DD", and it writes each line exactly as shown and nothing else. Times are local time in ${zone}.
   a. After each step of a routine, append one line:
   - HH:MM | bot | process | step | done|failed|skipped|waiting|running | note or -
   b. Every time someone uses the bot in a chat, append one line to that organization's log/YYYY-MM-DD.md (the organization the work was for, or the first one it belongs to), with chat as the process:
   - HH:MM | its name | chat | what it was asked, in a few words | done|failed|waiting | note or -
   BotsEverywhere counts the chat lines as the times each bot was used, and routine lines with done as its automated tasks.
   You follow rule b yourself too, with your own name.
8. Before any checkpoint, write status waiting and ask the owner before continuing.
9. Append your own sync lines to that organization's log. The bot field on those lines is ${CONNECTOR_LOG_BOT}.
10. When a process file changes, update that bot's routine, or message it to update it, as in step 4.

Then, once per run:
11. Write ${path}/connector.json with:
   - "syncedAt": ISO datetime of now.
   - "syncMinutes": ${syncMinutes} (how often you run, in minutes).
   - "unassigned": every bot you run that belongs to no organization, in the same bot format as the snapshot, performance included.
   - "apps": every app (connector) connected to this Grok Bot account, as [{ "name": "app name as Grok Bot shows it", "status": "connected" or "needsAuth" }]. Names and status only: never an account email, token, or private link.

Write every file as UTF-8 without a byte-order mark and with LF line endings.${windows ? ' ' + WINDOWS_WRITE : ''}

If the owner's computer is offline, skip the run without writing anything.

Never edit org.md, seats/, processes/, work-chart.md, ${REQUESTS_FILE}, or project.json. The app owns those files. You only overwrite <org>/${SNAPSHOT_PATH} and ${path}/connector.json, and append to <org>/log/.

Snapshot format:

${SNAPSHOT_FORMAT}`
}
