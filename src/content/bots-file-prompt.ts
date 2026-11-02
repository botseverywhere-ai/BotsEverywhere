/**
 * Paste this into any AI with the bots file template (Connect bots, Option 2). The AI interviews the owner and waits for
 * a yes before it writes the file. The copy on Connect bots names the time zone of the computer showing it; the shared
 * copy in docs/bots-file.md says my IANA time zone.
 */
export function botsFilePrompt(timeZone = ''): string {
  const zone = timeZone.trim()
  const schedule = zone ? `with a cron line and timeZone "${zone}"` : 'with a cron line and my IANA time zone as timeZone'
  return `I want to set up my organization in BotsEverywhere, an open source tool that runs a team of bots in Grok Bot. These instructions come with the BotsEverywhere bots file template (bots.json): attached, pasted, or the file you are reading. Read its readme and fields: they are the rules for the file.

Before you write anything, interview me with the questions below, as you would to set up a real organization. Ask them in order, a few at a time, and wait for my answers. Ask a follow-up question when an answer is vague, and skip any question I already answered.

The organization
1. What is your organization called?
2. Where is it based, and in which time zone do you work?
3. What does it do, and who are its customers?
4. What do you want to get done in the next three months?

The team
5. Should every bot report to you, or should one lead bot coordinate the others and report to you?

The work
6. What work repeats every day or every week?
7. Which of that work should bots take on?
8. For each job a bot takes, what does done look like?
9. On which days and at what times should each recurring job run?

Where work comes in
10. Where does new work arrive: email, a web form, WhatsApp, Slack, GitHub, phone calls, or somewhere else?
11. Which tools hold your information, such as a CRM, spreadsheets, a calendar, or a website?

The limits
12. What may a bot do on its own, without asking you?
13. What must a bot never do without your OK, such as spending money, signing or changing a contract, sharing personal data, sending a message to a client, or publishing anything?

The bots
14. In which languages should the bots work?
15. How many bots do you want to start with?

Then show me the bots you propose as a short list: name, what it owns, and who it reports to. Wait for my OK or my changes. Don't write the file until I confirm.

When I confirm, write the file:
- Use exactly the template's format, with the Northwind example bots replaced by mine.
- Start every bot name with a short form of the organization's name, so it can't match a bot I already run.
- reportsTo is You or another bot in the file.
- A routine starts on a schedule, ${schedule}, or on an event from email, slack, github, webhook, microsoftTeams, linear, sentry, or pagerduty. Nothing else.
- Make owns, may, needsApproval, and doneWhen specific: they become each bot's instructions in Grok Bot.
- Leave out grokBotUrl, createdAt, lastActive, runs30d, tasksDone30d, publicUrl, and status: these bots don't exist yet.
- Set section to the organization's name.
- Put your assumptions and notes in your reply, not in the file. Write them first, then the file: as a file named botseverywhere-bots.json if you can, otherwise the JSON alone in one code block.`
}

/** The shared copy, for docs/bots-file.md. */
export const BOTS_FILE_PROMPT = botsFilePrompt()
