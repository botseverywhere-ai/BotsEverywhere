/** Paste this into Grok Bot. The wording is the import contract. */
export const GROK_BOTS_PROMPT = `List every bot I run in Grok Bot, including yourself, and save them as one file named botseverywhere-bots.json so I can import my team into BotsEverywhere.

Use exactly this JSON format and nothing else:

{
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

Rules:
- One entry per bot, using each bot's real name.
- Leave out any bot named "Connector - BotsEverywhere" or "Connector - BotsEverywhere (…)". It only syncs files.
- grokBotUrl may be the bot's Grok Bot link (grokbot://... is fine).
- owns, may, and needsApproval are lists of short strings.
- doneWhen is one string.
- For each bot, also include only what you can actually see: createdAt, lastActive, runs30d, tasksDone30d, routines (name, description, how it starts, schedule and time zone or event, whether it is paused, last run), and status (active, paused, or retired).
- skills are the reusable workflows listed on the bot: a name and, when you can see it, one line on what it does. Leave the list out if you see none.
- publicUrl is the bot's public share link. Include it only when the bot is public and you can see the link.
- If you do not know a value, leave the field out. Never estimate or invent numbers.
- Keep each item short, one line, in plain words.
- Base everything on each bot's actual description. Don't invent bots or duties.
- If you don't know a field, leave it out instead of guessing.
- Send me the file to download. If you can't, reply with only the JSON so I can save it myself.`

export const BOTS_FILE_NAME = 'botseverywhere-bots.json'
