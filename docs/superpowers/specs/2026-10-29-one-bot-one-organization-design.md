# One bot, one organization

Design, 29 October 2026. Branch `feature/multiple-orgs-main-grok-bot-&-connector`, on top of commit `be4a529`. Demo on 7 November 2026.

## Why

One Grok Bot account runs every bot, and one copy of BotsEverywhere can hold several organizations. For the demo: BotsEverywhere, Alicante Tech Vibes, techiewithmiguel, and aurafarming.world.

A bot that works for two organizations gets mixed up. Grok Bot counts its use as one total, its memory is shared, and a sender who manages it in both organizations is ambiguous. That was tested with Security on 28 October. So **a bot works for one organization**. Two bots are the exception and belong in every organization: **the main bot** (the owner's primary bot, Grok Bot for Miguel) and **the Connector**.

The first import should show who already reports to whom. Today **Import from Grok Bot** asks Grok Bot to write the file, and Grok Bot sees only the first line of every other bot's instructions (its own answer, 29 October), so most bots land under You. The Connector reads every bot's full instructions on every run. Asked on 29 October, it named the manager each bot's own text gives for all 19 bots. Its answer matched the graph a competitor (Grok Bot Graph) drew from Grok Bot's memory.

What BotsEverywhere does that the competitor does not: it reads the structure from each bot's own text, lets the owner change it on the org chart, and carries it back to the bots through their BotsEverywhere blocks. x.com, asked on 29 October, answered "In the BotsEverywhere org chart I report to Brand & Marketing", which is the app's structure, not its own text's.

## Goals

1. **Import from Grok Bot** brings every bot onto the org chart, with who reports to whom read from each bot's own text. Nothing to paste.
2. A bot already active in another organization arrives **greyed**. Clicking it says it is used there and offers **Move it here**, **Rename and publish in Grok Bot**, and **Remove**.
3. The main bot and the Connector come into every organization. The owner marks the main bot once, with one click.
4. Changing **Reports to** in BotsEverywhere keeps reaching the bot on the Connector's next run. This works today and must keep working.
5. Each bot reports only the skills it actually uses.

## Non-goals

- Editing a bot's own text or memory in Grok Bot. The app only ever writes its own block.
- Usage counts or routine names per organization for the main bot.
- Choosing which bots an organization imports by Grok Bot sidebar section. Raised, not decided; later.
- The interview import (organization file) creating people instead of bots. To review separately.

## Anti-goals

These would make it a failure even if it technically works:

- A bot quietly active in two organizations, other than the main bot and the Connector.
- The owner copying a bot id, or pasting anything new into the Connector.
- A greyed bot getting a BotsEverywhere block, Grok Bot's numbers, a match in Sync, or a "Not in Grok Bot" mark. Any of these puts it in two organizations through the back door.

## Decided

### Where the import's data comes from

The Connector's run (`orgs/grok-data.json`). `CONNECTOR.md` (written by the app in `connectorGuide`, `server/src/connector-prompt.ts`, so nothing is pasted) gets these rules for every bot, ignoring every `=== BotsEverywhere` block:

- `reportsTo`: the bot or person its own text says it reports to, by its exact name in Grok Bot. "Grok Bot manages all botseverywhere work" counts for a botseverywhere bot. Left out when the text names no one.
- `alsoReportsTo`: anyone else its own text says it reports to. Left out when none.
- `self`: the Connector's own id, name, and link. The rules today say "every bot except yourself", so the dump never names the Connector.

A dump without these fields (an older Connector) still reads, and the import then places bots under You.

### Import from Grok Bot

- Once the Connector has run, Step 2 on Connect bots imports from its latest dump with one button. Before that, today's prompt stays as the way in.
- Every bot in the dump comes in. A bot active in another organization comes in greyed. A bot retired elsewhere comes in normally.
- Every bots-file import works the same way: the one-button import, the pasted file from today's prompt, and the template file (Option 2). None of them skips a bot active elsewhere any more; it comes in greyed. *(Builder's call.)*
- Each bot goes under the manager its own text names, when that manager comes in active here. Otherwise it goes under You, with a note. A bot that works here never reports to a greyed bot.
- A bot that comes in greyed keeps the managers it has in the organization it works for, main and extra, matched here by Grok Bot id, when they come in or are already here; a greyed bot may report to a greyed bot, since neither gets a block. Without that, it goes by its own text like any other bot. *(30 October: own text alone left a second organization flat, under You, though the owner had set the structure in the first.)*
- A seat placed under You because the manager its text names arrived greyed remembers that name. When that manager becomes active here (**Move it here** or **It's my main bot**), the seat moves under it, unless the owner has moved the seat since. *(Builder's call.)*
- The Connector's seat takes its link from `self` in the dump; without it, from the Connector's seat in another organization; without either, it comes in without a link. *(Builder's call.)*
- The import still fills an empty organization once, as today (`importLocked`). The main bot does not count toward that lock or toward `orgImportLocked`, as the Connector already does not. *(Builder's call.)*

### The main bot

Grok Bot has no main-bot setting the Connector can read (it looked, 29 October), and people rename their main bot, so the app is told once, with one click. Nothing is guessed.

- The first time the main bot is imported while it is active in another organization, it arrives greyed like any other bot, with a fourth button: **It's my main bot**.
- One click saves it by Grok Bot id in `orgs/project.json` and makes its seat here active. Renaming the bot later changes nothing.
- From then on the main bot is never greyed and never refused, in any organization, in the import or in Add existing bot. It comes in under You unless its own text names a manager.
- There is one main bot. Clicking **It's my main bot** on another bot replaces the saved one and moves no seat. *(Builder's call.)*
- The main bot and the Connector come in through the import or Add existing bot. The app does not add them to an organization on its own, when it is created or later. *(Builder's call.)*
- Changing the main bot later moves no seat.

### Greyed bots

- On the org chart: a greyed card labeled **In <Organization>**, under the manager it has in that organization when that manager is here, else under the manager its own text names when that manager is active here, else under You.
- Clicking it opens the seat panel with one box instead of the usual tabs: "<Bot> is used in <Organization>. A bot works for one organization." (the message text from `be4a529`) and the buttons below, plus **It's my main bot** while no main bot is saved.
- **Move it here.** The bot's seat is retired in every other organization where it is active, and its seat here becomes active with its link. The bots that reported to it there go under its old manager there. The retirement says it moved, and **Delete in Grok Bot** is not offered for it. The Connector swaps the bot's block on its next run.
- **Rename and publish in Grok Bot.** A name field, filled in with "<Bot> - <Organization>". Publishing renames the seat, drops its link, and sends the existing **Create in Grok Bot** request, so the Connector creates a new bot with that name in the sidebar section named like the organization. The new bot gets the seat's Profile instructions, or else its card, as **Create in Grok Bot** does today. It never gets the original bot's own text, which is about the original's organization (Security's text is about botseverywhere.ai's keys and servers). The original bot is untouched.
- **Remove.** The greyed seat file is deleted, since the bot never worked here, and one line is logged.
- When the bot is later no longer active elsewhere, the seat stays greyed until the owner clicks **Move it here**, which then has nothing to retire.

### Skills

The profile form in every block (`profileForm` in `server/src/profile-reports.ts`) asks for "private skills you use in your work", like Apps used, instead of every skill turned on for the bot. Today x.com lists all 6 shared skills, while its block says it uses none. Every bot's block is rewritten once on the Connector's next run.

### Already built (`be4a529`)

The check by Grok Bot id for a bot active in another organization, the Connector never refused, the message text, and **Add anyway** in Add existing bot all stay. The skip in `importBotsFile` becomes greyed seats, for every path that uses it. **It's my main bot** replaces **Add anyway** as the normal way in; the button stays as a safety net.

## Constraints

- The hard rules in `CLAUDE.md` and `AGENTS.md`: organization in user-facing text, square corners, tokens, `Button`, native selects; every org-file reader tolerates a BOM, CRLF, and a bad file; a request about every organization reads each one once; a folder is never derived from a name.
- The Connector reads only `orgs/`, never edits the app's files, and new dump fields are optional.
- `npm test` and `npm run build` pass before each commit. Small commits.
- The demo is on 7 November.

## Left to the builder

- How a greyed seat is stored, as long as the anti-goals hold.
- The greyed card's look, within the tokens and the existing Grok Bot states on bot cards (`src/components/sync-copy.ts`).
- The order of commits and the tests.

## Open

- Whether the Connector names the same managers from one run to the next. The import reads a single run.
