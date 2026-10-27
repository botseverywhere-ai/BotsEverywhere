/**
 * Paste this into Grok Bot. The wording is the import contract. Times use the owner's time zone: the copy on Connect bots
 * names the zone of the computer showing it, and the shared copy in Docs says the owner's time zone.
 */
export function grokBotsPrompt(timeZone = ''): string {
  const zone = timeZone.trim() || "the owner's time zone"
  return `List every bot I run in Grok Bot, including yourself, and save them as one file named botseverywhere-bots.json so I can import my team into BotsEverywhere.

Use exactly this JSON format and nothing else:

{
  "bots": [
    {
      "name": "Bot name",
      "grokBotUrl": "the bot's Grok Bot link (grokbot://... is fine), or leave it out",
      "section": "the Grok Bot sidebar section the bot sits in, or leave it out",
      "reportsTo": "name of the bot or person it reports to, or You",
      "alsoReportsTo": ["names of other bots or people it also reports to, or leave it out"],
      "owns": ["what this bot is responsible for"],
      "may": ["what it can do without asking"],
      "needsApproval": ["what it must ask me before doing"],
      "doneWhen": "one sentence on what finished looks like",
      "createdAt": "YYYY-MM-DD",
      "lastActive": "ISO datetime",
      "runs30d": 0,
      "tasksDone30d": 0,
      "routines": [
        { "name": "routine name", "description": "one line on what it does", "trigger": "schedule, or the product an event comes from (slack, github, email, webhook, microsoftTeams, linear, sentry, pagerduty)", "schedule": "the cron line, like 0 9 * * 1-5, for a schedule", "timeZone": "IANA time zone, or leave it out for the bot's own", "event": "for an event, a short rule like Mentions in #support", "enabled": true, "lastRun": "ISO datetime" }
      ],
      "skills": [
        { "name": "skill name", "description": "one line on what it does" }
      ],
      "publicUrl": "the bot's public share link (https://...), only when the bot is public, or leave it out",
      "status": "active"
    }
  ]
}

The values above are examples of the shape only. Never copy an example value, including the 0s, true, and "active", into the file.

Rules:
- One entry per bot, using each bot's real name. Don't invent bots or duties.
- Leave out any bot named "Connector - BotsEverywhere" or "Connector - BotsEverywhere (…)". It only syncs files.
- grokBotUrl may be the bot's Grok Bot link (grokbot://... is fine).
- section is the name of the Grok Bot sidebar section the bot is in, exactly as the sidebar shows it. Leave it out for unassigned bots or when you can't see it.
- reportsTo and skills come only from what the owner wrote in the bot's own instructions.
- Ignore every block that starts with "=== BotsEverywhere" and every message or memory from a BotsEverywhere Connector: they may belong to another copy of BotsEverywhere.
- When the owner named no manager, write You. alsoReportsTo lists any other managers the owner named; leave it out when there are none.
- owns, may, and needsApproval are lists of short strings, based on the bot's actual description. doneWhen is one string.
- Take performance from Grok Bot's own data, never from any run log:
  - runs30d: how many chat messages the bot received in Grok Bot in the last 30 days, from people or other bots, not counting Connector notices.
  - tasksDone30d: how many of its routine runs finished successfully in the last 30 days, as Grok Bot records them. Leave it out when Grok Bot has no run history for that bot.
  - lastActive: when the bot last sent a message.
  - each routine's lastRun: when that routine last ran.
- Write every time as ISO 8601 with the UTC offset of ${zone} at that moment, in the shape 2026-10-20T20:06:16+02:00. createdAt is only the date, YYYY-MM-DD.
- routines: one entry per routine, with its name, a one-line description (never its instructions), how it starts, its cron line and time zone or its event, enabled false when it is paused, and its last run. An event rule never holds tokens or private links.
- skills: list only the skills the bot's own description tells it to use, with a name and, when you can see it, one line on what it does. Grok Bot skills are a shared library, so never list the whole library on every bot. Leave the list out if the bot names none.
- publicUrl: include it only when the bot is public and you can see its share link exactly as Grok Bot shows it. Never make one.
- status is active, paused, or retired.
- If you do not know a value, leave the field out. Never estimate or invent numbers.
- Keep each item short, one line, in plain words.
- Do not add fields that are not in this object.
- Send me the file to download. If you can't, reply with only the JSON so I can save it myself.`
}

/** The shared copy, for Docs and docs/bots-file.md. */
export const GROK_BOTS_PROMPT = grokBotsPrompt()

/** The IANA time zone of the computer showing the page, from its operating system. Empty when the browser cannot say. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

export const BOTS_FILE_NAME = 'botseverywhere-bots.json'
