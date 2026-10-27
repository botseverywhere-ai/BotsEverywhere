# Bots file

The same `bots` objects described here are what the Connector writes into `orgs/<slug>/grok/snapshot.json` on every run, next to `syncedAt` and a `processes` list in the processes-file format. **Sync with Grok Bot** reads that snapshot; this page describes the one-off import and export.

Organization Overview → **How to link your organization to BotsEverywhere** uses one JSON file both ways. **Import from a template .json (build an organization from an interview with an LLM)** downloads the template and imports a file. Once the organization has bots, Step 2 is locked for import and holds **Export bots file**. Zip **Backup** (Export, Import zip, Import folder) sits under the organization fields and replaces the whole org.

**Export bots file** downloads `botseverywhere-bots.json` built from `seats/*.md`. Each bot seat is one entry. A directory bot is included, and its `addToGrokBotUrl` is written as `grokBotUrl`. People, including You, are not in the file.

**Import bots file** reads that same file. The page shows a preview and waits for **Import**. Nothing is written before that. One bot at a time is still **Add existing bot** on the org chart.

Export, then import into a new empty organization, recreates the same bot seats: name, who they report to, the four card sections, and the Grok Bot link.

## Paste this into Grok Bot

A new organization, and an org that has no bots yet, can start with **Import from your Grok Bot**. Copy this prompt, paste it into your Grok Bot, and save the answer as `botseverywhere-bots.json`. The empty org chart opens that panel. Organization Overview leaves all three panels closed.

```text
List every bot I run in Grok Bot, including yourself, and save them as one file named botseverywhere-bots.json so I can import my team into BotsEverywhere.

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
- Write every time as ISO 8601 with the UTC offset of the owner's time zone at that moment, in the shape 2026-10-20T20:06:16+02:00. createdAt is only the date, YYYY-MM-DD.
- routines: one entry per routine, with its name, a one-line description (never its instructions), how it starts, its cron line and time zone or its event, enabled false when it is paused, and its last run. An event rule never holds tokens or private links.
- skills: list only the skills the bot's own description tells it to use, with a name and, when you can see it, one line on what it does. Grok Bot skills are a shared library, so never list the whole library on every bot. Leave the list out if the bot names none.
- publicUrl: include it only when the bot is public and you can see its share link exactly as Grok Bot shows it. Never make one.
- status is active, paused, or retired.
- If you do not know a value, leave the field out. Never estimate or invent numbers.
- Keep each item short, one line, in plain words.
- Do not add fields that are not in this object.
- Send me the file to download. If you can't, reply with only the JSON so I can save it myself.
```

## Paste this into any AI

Option 2, **Import from a template .json (build an organization from an interview with an LLM)**, is for an organization built with any AI (Claude, ChatGPT, Gemini, Codex, Grok Bot, or another). Copy this prompt, give it to the AI together with the downloaded template (attached, or pasted below the prompt), answer its questions, confirm the bots it proposes, and import the file it writes. The template carries the same prompt as its `instructions` list, so an AI given only the file does the same. An AI that cannot make a file replies with the JSON in one code block: save that block as a `.json` file, or save the whole reply; the import reads the one `json` code block in it. The copy on Connect bots names the time zone of the computer showing it.

```text
I want to set up my organization in BotsEverywhere, an open source tool that runs a team of bots in Grok Bot. These instructions come with the BotsEverywhere bots file template (bots.json): attached, pasted, or the file you are reading. Read its readme and fields: they are the rules for the file.

Before you write anything, interview me with the questions below, as you would to set up a real organization. Ask them in order, a few at a time, and wait for my answers. Ask a follow-up question when an answer is vague, and skip any question I already answered.

The organization
1. What is your organization called?
2. Where is it based, and in which time zone do you work?
3. What does it do, and who are its customers?
4. What do you want to get done in the next three months?

The team
5. Who works in the organization, and what does each person do?
6. Should every bot report to you, or should one lead bot coordinate the others and report to you?

The work
7. What work repeats every day or every week?
8. Which of that work should bots do, and which stays with people?
9. For each job a bot takes, what does done look like?
10. On which days and at what times should each recurring job run?

Where work comes in
11. Where does new work arrive: email, a web form, WhatsApp, Slack, GitHub, phone calls, or somewhere else?
12. Which tools hold your information, such as a CRM, spreadsheets, a calendar, or a website?

The limits
13. What may a bot do on its own, without asking you?
14. What must a bot never do without your OK, such as spending money, signing or changing a contract, sharing personal data, sending a message to a client, or publishing anything?

The bots
15. In which languages should the bots work?
16. How many bots do you want to start with?

Then show me the bots you propose as a short list: name, what it owns, and who it reports to. Wait for my OK or my changes. Don't write the file until I confirm.

When I confirm, write the file:
- Use exactly the template's format, with the Northwind example bots replaced by mine.
- Start every bot name with a short form of the organization's name, so it can't match a bot I already run.
- reportsTo is You or another bot in the file.
- A routine starts on a schedule, with a cron line and my IANA time zone as timeZone, or on an event from email, slack, github, webhook, microsoftTeams, linear, sentry, or pagerduty. Nothing else.
- Make owns, may, needsApproval, and doneWhen specific: they become each bot's instructions in Grok Bot.
- Leave out grokBotUrl, createdAt, lastActive, runs30d, tasksDone30d, publicUrl, and status: these bots don't exist yet.
- Set section to the organization's name.
- Put your assumptions and notes in your reply, not in the file. Write them first, then the file: as a file named botseverywhere-bots.json if you can, otherwise the JSON alone in one code block.
```

## File

One JSON object. The only required key is `bots`, a list.

```json
{
  "bots": [
    {
      "name": "Invoice Bot",
      "grokBotUrl": "",
      "reportsTo": "You",
      "owns": ["Match the invoice to the purchase order"],
      "may": ["Read the bill and the purchase order"],
      "needsApproval": ["Pay the vendor"],
      "doneWhen": "The match is recorded"
    },
    {
      "name": "Collections Bot",
      "reportsTo": "Invoice Bot",
      "owns": ["Chase the unpaid invoice"],
      "may": ["Read the open invoices"],
      "needsApproval": ["Send a legal notice"],
      "doneWhen": "The reminder is sent or the invoice is marked paid"
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Seat name. Becomes the file name: `Invoice Bot` → `seats/invoice-bot.md`. The file frontmatter is `name`, `kind: bot`, `source: existing`, `grokBotUrl`, and `reportsTo`. |
| `grokBotUrl` | no | An http or https URL, or a Grok Bot app link (`grokbot://...`). The seat file stores it as `grokBotUrl` with `source: existing`. When it is set, the seat card shows **Open in Grok Bot**. Any other value is left out, the bot still imports, and the page counts a note. |
| `reportsTo` | no | Seat name, not a file name. Defaults to `You`. `You` is the founder seat (the seat titled You, or the `you` seat). A name that is not a seat here places the bot under You, with a note. |
| `alsoReportsTo` | no | A list of seat names the bot also reports to, shown as dotted lines on the org chart. A name that is not a seat here is left out, with a note. |
| `owns` | no | A list of short strings. A single string is one item, or several when it is split on new lines or `"; "`. Items that are not strings are saved as text. Leave it out, or use null, when you do not know it. |
| `may` | no | Same shape as `owns`. |
| `needsApproval` | no | Same shape as `owns`. This is the seat card section **Needs approval**. |
| `doneWhen` | no | One string. A list is joined with a space. A number is saved as text. Line breaks in a string become extra lines. Leave it out, or use null, when you do not know it. |
| `createdAt` | no | ISO date. A date string is kept. Anything else is left out and counted as a note. |
| `lastActive` | no | ISO datetime of the bot's last run. This is not the time the file was imported. |
| `runs30d` | no | Whole number. A numeric string is coerced. Anything else is left out and counted as a note. |
| `tasksDone30d` | no | Same as `runs30d`. |
| `routines` | no | A list of `{ name, description, trigger, schedule, timeZone, event, enabled, lastRun }`. `trigger` is `schedule` or the product an event comes from (`slack`, `github`, `email`, `webhook`, `microsoftTeams`, `linear`, `sentry`, `pagerduty`; `cron` reads as `schedule`). `schedule` is the cron line; an older file's schedule in words, or in `trigger`, still loads. `timeZone` is an IANA name; one that does not exist is left out. `enabled: false` means paused. `description` is one line on what it does, never the instructions. A bad entry is skipped and counted as a note. |
| `skills` | no | A list of `{ name, description }`: the reusable workflows Grok Bot lists on the bot. A skill without a name is left out. Shown in the seat's Profile tab. |
| `publicUrl` | no | The bot's public share link, only when the bot is public. An https link; anything else is left out with a note. Shown in Profile as **Get this bot**, never edited in the app. |
| `status` | no | `active`, `paused`, or `retired`. Stored as `botStatus` so it does not replace the seat's active or retired status. |

`reportsTo` and `alsoReportsTo` may name another bot in the same file. The writer makes two passes: it creates every seat file first, then it sets `reportsTo` for bots that report to someone who was just imported. A bot listed first can report to a bot listed later. Extra managers that would make a loop are left out, with a note.

If `seats/<slug>.md` already exists, the new bot is saved as `seats/<slug>-2.md`. The first file is not overwritten. The same rule applies inside one file when two different names would share a file name.

Those performance fields are saved in the seat frontmatter and written back by **Export bots file**. Any other extra field is ignored. A bot is skipped only when it has no name. A file that is not JSON, or that has no bots list, is not imported. A leading byte-order mark, Windows line endings, and a saved AI reply with notes around one `json` code block still import. Bots that only have a note still import. The page then re-reads the org chart. A clean file says **Imported N bots**. A file that left some links out says **N bots imported, M notes**.

**Download bots file template** on Connect bots saves `public/bots-file-template.json` as `bots.json`: a `readme` for a person or any AI, a `fields` guide to every field in the same order as the Grok Bot prompt, and three complete Northwind example bots. The import reads only `bots`, so a file that keeps `readme` and `fields` still imports. **Export bots file** saves the org you have open as `botseverywhere-bots.json`. Zip export, zip import, and folder import stay on the same page for a full backup.
