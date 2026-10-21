# Retired in the legend, Delete from Grok Bot, and last sync in the header

Date: 2026-10-20. Status: built, with one change. Grok Bot gives the Connector no delete tool, so section 3's delete request, its Cancel, and the Connector instruction were dropped (commits `47613c4`, `e8715ad`). **Delete in Grok Bot** opens the bot so the person deletes it there, and each Connector run marks a retired bot deleted (`grokDeletedAt`) once no report lists it. Sections 1 and 2 are built; later commits made every legend number open a list. See `AGENTS.md`.

## Why

BotsEverywhere is organized bot management: at a glance, which bots are in the organization, who reports to whom, and the work chart processes. The app is where Miguel manages bots; Grok Bot follows it through the Connector. Today three things break that:

1. Retiring a bot never reaches Grok Bot, and there is no way to remove a bot from Grok Bot from the app. Miguel retired Inbox Bot and could not delete it in Grok Bot from here.
2. Retired seats sit in a small collapsed **Retired (N)** list under the org chart, names only, with no human/bot distinction.
3. The header badge says **Connected** but not when the Connector last ran. The time is computed (`connectorState` in `src/components/sync-copy.ts` builds `Connected · last run 2 min ago`) but only shown as the badge's hover title.

## Two separate actions (decided by Miguel)

- **Retire** removes a seat from *this* organization only. The bot keeps running in Grok Bot, because another organization may use it or Miguel may seat it again later. Retire does exactly what it does today. Unchanged.
- **Delete from Grok Bot** removes the bot from the Grok Bot account. It is a deliberate choice made in the app. It travels the same way hiring (**Create in Grok Bot**) does: the app writes a request, the Connector reads it on its next run and deletes the bot, and the app shows the request as waiting until the Connector's report no longer includes that bot.

One Grok Bot account runs every bot, and the same bot may sit in several organizations (see `AGENTS.md` and the Connector prompt). That is normal and must never be blocked or flagged as a conflict.

## Goals

### 1. Last sync in the header

The header badge (`src/components/GrokStatusBadge.tsx`) shows when the Connector last ran, visible without hovering. The data already exists: `connectorState` reads the project Connector's `orgs/connector.json` stamp (or the org snapshot for an older per-org Connector).

- Builder's call (mine, Miguel can change it): the small line under the state word becomes `Grok Bot · 15:01` when the run was today, and `Grok Bot · 19 Oct, 18:25` otherwise, in local time. The hover title keeps the full `Connected · last run 2 min ago` line.
- Show it for every state that has a last run: Connected and Disconnected (stale, over `CONNECTOR_STALE_MINUTES` = 30). Not connected, Error and Writer off keep their current text.

### 2. Retired in the legend

The org chart legend (`src/components/OrgChart.tsx`, the row `Human · Bot · System · In Grok Bot · Not in Grok Bot`) gets one more entry, **Retired N**, on an organization of your own (`grokStates={editable}`). Templates and samples do not show it.

- Clicking **Retired** opens a list of every retired seat in this organization, humans and bots. Each row: name, Human or Bot (System too, if one is ever retired), and retired date (`retiredAt`).
- A retired bot's row also shows its Grok Bot state and, when allowed (below), a **Delete from Grok Bot…** button. While a delete request is waiting, the row says so instead of the button. After the Connector confirms, the row says **Deleted from Grok Bot** with the date.
- The collapsed **Retired (N)** list under the chart (`src/pages/Workspace.tsx`, `.be-retired`) is removed. The legend replaces it.
- Builder's call: the list opens as a drawer in the same style as the existing drawers, not a popover. Retired N shows `0` and is not clickable when nobody is retired.

### 3. Delete from Grok Bot

**Who can be deleted:** a retired bot seat whose Grok Bot link (`grokBotUrl`) is set. The link is how the Connector finds the right bot, since two bots can share a name. A retired bot without a link is not offered the button (nothing to delete, or no safe way to find it).

**Warning when the bot still works elsewhere (decided by Miguel):** before writing the request, the app checks every organization in the orgs folder for an active seat with the same Grok Bot link. If any exist, the confirm dialog names them, for example: *"Invoice Bot is still active in Meridian Ledger Partners. Deleting it in Grok Bot stops it there too."* Miguel can still confirm. Warn, never block.

**Confirm dialog:** names the bot, says it is removed from the Grok Bot account on the Connector's next run (up to 15 minutes), and that the seat stays retired here. Same modal style as **Delete organization…** in `src/components/OrgMenu.tsx`. Builder's call: a plain Cancel / Delete from Grok Bot confirm, no type-the-name step, since the seat is already retired and the bot can be recreated.

**The request:** `grok/requests.json` today holds create requests only (`server/src/grok-requests.ts`). It gains delete requests. Each delete request carries at least the bot name, the Grok Bot link, the seat slugs that hold that link, and `requestedAt`. An existing file of create-only entries must keep working, and a bad file is still skipped, never a crash (`CLAUDE.md` file-reader rule).

- My call: delete requests go under their own key (for example `deletes`), not inside `requests`, so a Connector still on the old prompt never reads a delete as a create.
- My call: a delete request is keyed by Grok Bot link, not by seat. Inbox Bot has two retired seats with the same link (`inbox-bot.md`, `inbox-bot-2.md`); asking from either one makes one request, both rows show it as waiting, and a confirmed delete is recorded on every seat in this organization with that link.

**The Connector prompt** (`connectorPrompt` in `server/src/connector-prompt.ts`) gains an instruction: for each delete request, delete the bot whose Grok Bot link matches, in Grok Bot. Never delete a bot whose link does not match. Never delete itself. It still never edits `requests.json`. Miguel must paste the new prompt into the Connector in Grok Bot once, from the Connect bots tab. The app has no "prompt changed" note today, so the builder adds a short one on the Connect bots tab and in the delete confirm dialog: the Connector acts on deletes only after its prompt is replaced.

**Clearing the request:** a delete request is done when the Connector's own report no longer includes a bot with that link: not in this organization's `grok/snapshot.json`, not in any other organization's snapshot, and not in `orgs/connector.json` `unassigned`. Only the Connector's own files clear it, never a pasted file (same rule as create).

- It clears by itself on the Connector run that shows the bot gone, with no Sync confirm needed, so the retired row changes on its own. The check belongs with the watcher that already handles each `connector.json` change (`recordConnectorRun` in `server/src/connector-log.ts`). Create requests keep clearing on a confirmed sync as today.
- My call, to keep the anti-goal: be strict. Only a Connector run newer than `requestedAt` counts. An unreadable Connector file counts as "bot still present". An entry with the same name and no link counts as "still present".
- The watcher already logs "X is no longer in Grok Bot" per organization. The confirm event should not duplicate it; the builder merges or replaces as fits.

When it clears, the seat file records it (builder's call on the field name, alongside `grokSync`, `grokSyncedAt`, `grokMissingSince`), so the retired list can say **Deleted from Grok Bot** with the date.

**Cancel a waiting delete (decided by Miguel):** while a delete request waits, a **Cancel** button sits on its row in the retired list and in the Sync drawer. Cancel removes the request from `grok/requests.json`, the row goes back to showing **Delete from Grok Bot…**, and the app logs a To Grok Bot event saying the delete was cancelled. Cancel only stops a request the Connector has not acted on yet; if Grok Bot already deleted the bot, the next run clears it as usual. Create requests stay without a cancel; that is not part of this work.

**The Sync drawer** (`src/components/SyncDrawer.tsx`) shows waiting delete requests on the **Going to Grok Bot** side next to waiting create requests, so the Connector's to-do list is in one place.

**Activity log:** writing a delete request logs a To Grok Bot event (`grok: out`), like a create request. The Connector confirming the delete logs a From Grok Bot event (`grok: in`). Both show on the Logs tab with the existing badges.

**Other organizations after a delete:** nothing in them is deleted. On their next sync the bot is missing from Grok Bot, so their seat is tagged `grokSync: missing` and the card shows **Not in Grok Bot**, exactly as today for any bot that disappears from Grok Bot.

## Non-goals

- Retire does not change, and does not ask about Grok Bot.
- No deleting of seat files. A retired seat stays on disk with `status: retired`, so history and logs keep working.
- No delete for bots in **In Grok Bot, no organization** (`unassigned`) in the Sync drawer. Possible later; not asked for.
- No change to the Overview tab's counts list (`src/pages/CompanyOverview.tsx`).
- No un-retire / rehire of a retired seat.
- Not investigating why Inbox Bot has two retired seats (`inbox-bot.md`, `inbox-bot-2.md`) with the same link. Separate issue.

## Anti-goals (would be a failure even if it works)

- A delete that removes the wrong bot in Grok Bot. Matching is by Grok Bot link, never by name alone.
- Blocking or flagging a bot because it sits in several organizations.
- Any change that lets a bad `requests.json`, snapshot, or `connector.json` crash the writer or turn the app white.
- A request that clears itself before Grok Bot actually lost the bot.

## Constraints

From `CLAUDE.md` and `AGENTS.md`: user-facing text says organization; square corners; colors, type, space and radius from `src/styles/tokens.css`; buttons are `src/components/Button.tsx`; every org-file reader tolerates a BOM, CRLF, and a bad file; change only what is asked; small commits on a branch, never push to `main` without Miguel's OK; `npm test` and `npm run build` before committing. Docs (`src/pages/DocsPage.tsx`, the Connector section) should describe the new request and the new Connector step.

## Left to the builder

Request file shape for delete entries, the seat field that records a confirmed delete, the drawer vs. popover detail for the retired list, exact copy for the header time and dialogs, and test layout. Tests should cover: the request file round-trip with mixed entries and a bad file; clearing only when the link is gone from every Connector file; the other-organization warning lookup; cancelling a waiting delete; the legend count; the header time formatting.
