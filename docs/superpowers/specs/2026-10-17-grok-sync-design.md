# Grok Bot sync

Design for keeping an organization in BotsEverywhere and the bots in Grok Bot in step with each other, both ways, without copy and paste after the first setup. Written 2026-10-17 for the local template build. Approach A from the brainstorm: the org folder is the channel.

## 1. Goal

BotsEverywhere is the consultant. Grok Bot is where the bots run. The app owns the structure: who reports to whom, which seat does which step, and the four card sections. Grok Bot owns the facts: whether a bot exists, its link, its routines and schedules, and its run numbers. A sync never deletes anything.

Success looks like this. The Connector routine runs on its schedule. A "Sync with Grok Bot" button on the org tab row shows what changed: "3 new, 1 missing, 24 updated". Confirm applies it. A bot moved under a new manager in the app is read by the Connector on its next run. New routines in Grok Bot appear as processes on the Work Chart. Nothing is pasted by hand unless Grok Bot cannot reach the folder.

## 2. What exists today

- The Connector prompt on Organization Overview tells Grok Bot to read `org.md`, `seats/`, and `processes/` and create one routine per process. Grok Bot can read and write this folder on this computer. It wrote a run-log line on 2026-10-17 at 22:10.
- Bots reach the org only through the "Import from your Grok Bot" JSON, parsed by `server/src/bots-file.ts`. Routines reach the org only through the processes JSON, parsed by `server/src/processes.ts`.
- The writer watches `log/`, `processes/`, `seats/*.md`, and `org.md` and pushes `log`, `processes`, and `org` events on `GET /api/orgs/<slug>/live`. The app re-reads the org on `org` and `processes` events.
- A seat's manager cannot be changed in the app.

## 3. The snapshot contract

**Path.** `orgs/<slug>/grok/snapshot.json`. The Connector overwrites it at the start of every run. It is the only file Grok Bot is told to overwrite. `readOrgDir` never reads `grok/`, so a broken snapshot cannot make the org unreadable.

**Shape.**

```json
{
  "syncedAt": "2026-10-17T22:10:00Z",
  "bots": [],
  "processes": []
}
```

`bots` holds the same objects as `botseverywhere-bots.json` and is read by `parseBotsFile`. `processes` holds the same objects as the processes prompt and is read by `parseProcessesFile`. Both parsers ignore extra keys, so one file parses with both and no parser changes. `syncedAt` is optional; the file's modification time is the fallback. The reader strips a byte-order mark and normalizes CRLF before `JSON.parse`, like every other org-file reader.

**Encoding asked of Grok Bot.** UTF-8 without a byte-order mark, LF line endings. The reader tolerates both anyway.

**Watcher.** `orgChange` gains one branch: `<slug>/grok/` emits a `grok` live event.

## 4. Connector prompt changes

`connectorPrompt` in `server/src/connector-prompt.ts` gains these lines, in this order after the folder path:

- "Run this routine every 15 minutes." The user can change the number in the pasted text. This schedule is the sync latency.
- "At the start of every run, write `<path>/grok/snapshot.json` with every bot you run, including yourself, in the same format and under the same rules as the import prompt, plus every routine in the same format as the processes prompt. Write it as UTF-8 without a byte-order mark and with LF line endings."
- "Never edit `org.md`, `seats/`, `processes/`, or `work-chart.md`. The app owns those. You only overwrite `grok/snapshot.json` and append to `log/`."
- "Read `reportsTo` in each seat file and tell that bot who its manager is."

The existing steps stay: create or update a routine per process for the owning bot, tell each bot to read its process file and seat file before a run, append run-log lines, write `waiting` before a checkpoint, and sign sync lines as `Connector`.

The bots-file prompt and the processes prompt are unchanged. A new `GROK_SNAPSHOT_PROMPT` in `src/content/grok-snapshot-prompt.ts` asks for the combined file in one reply, for the paste fallback. It reuses the two existing rule lists.

## 5. Merge rules

**Matching.** A snapshot bot matches a seat by `grokBotUrl` first, when both are set, then by name against the seat title, trimmed and case-insensitive. The Connector itself matches the Connector seat by name.

**Rows.** The plan is a list of rows, one per bot or routine, each with one kind:

- **new** — in the snapshot, no match in the org. Created through `createExistingBot` with `allowEmptyCard`. `reportsTo` is resolved like the import does: You, an existing seat by title, or another bot in the same snapshot, in two passes. An unknown manager falls back to You with a note instead of failing the row. The seat gets `grokSync: new` and `grokSyncedAt`.
- **renamed** — matched by `grokBotUrl` and the name differs. The seat title and role update to the new name. The file name never changes. Counted under updated in the summary line.
- **updated** — matched, and at least one fact differs. Facts are `grokBotUrl`, `createdAt`, `lastActive`, `runs30d`, `tasksDone30d`, `routines`, `botStatus`. They are taken from the snapshot. Structure is never taken from the snapshot: `reportsTo`, `department`, `directoryId`, `status`, and the four card sections. One exception: a card section that is empty in the seat takes the snapshot text; a filled one is left alone. A seat flagged missing that reappears counts here and the flag clears. The seat gets `grokSync: synced` and `grokSyncedAt`.
- **unchanged** — matched and nothing differs. No file is rewritten. Confirming the same snapshot twice writes nothing.
- **missing** — an active seat of kind bot with no match. The seat gets `grokSync: missing` and `grokMissingSince` set to the snapshot's `syncedAt`. It is never deleted or retired by a sync. A seat already flagged missing is unchanged. Humans, system seats, and retired seats are never flagged.
- **new process** — a routine whose name matches no process by `processSlug`. Written through `importProcessRows`, which now skips an existing name.
- **schedule warning** — a routine that matches a process whose trigger schedule differs. Nothing is written. The row shows both values. The user resolves it by editing the process; the Connector then updates the routine.

Processes are never deleted, flagged, or changed by a sync.

**Summary line.** `N new, N missing, N updated` with zero counts left out, plus `, N new processes` when any. Renamed rows count as updated.

**Record.** Each confirmed sync that wrote at least one file appends one log event: `id` `sync-<syncedAt>`, `type` `edit`, `actorSeatId` the Connector seat slug when present, else `grok-bot`, `actorType` `bot`, `summary` the summary line. New seats also get their usual `existing-<slug>` hire event from `createExistingBot`. The Logs tab is the history. "Last confirmed" in the panel is the newest sync event.

## 6. Seat frontmatter additions

`SeatDocument` gains three optional fields: `grokSync` (`new`, `synced`, or `missing`), `grokSyncedAt` (ISO datetime), and `grokMissingSince` (ISO datetime). `parseSeatMarkdown` reads them; both `serializeSeat` and `serializeExistingSeat` write them through `metricLines`, so a rewrite never drops them. `companyFromBundle` copies them onto `Seat` so the chart and drawer can show them.

## 7. Writer API

New module `server/src/grok-sync.ts` with pure functions and one writer:

- `readSnapshot(root)` → `{ ok: true, snapshot, stamp, syncedAt } | { ok: false, error, stamp }`. `stamp` is modification time plus size, used to detect a change between preview and apply.
- `parseSnapshot(text, fallbackSyncedAt)` → bots rows, process rows, `syncedAt`, or an error string from the existing parsers.
- `planSync(snapshot, seats, processes)` → `SyncPlan` with the rows above and the counts.
- `applySync(root, orgId, plan)` → writes through `createExistingBot`, `importProcessRows`, and a frontmatter update helper, and appends the sync event. Returns per-row results and the files written.

Routes in `template-server.ts`:

- `GET /api/orgs/<slug>/sync` → `{ snapshot: { stamp, syncedAt } | null, error: '', plan: SyncPlan | null, lastConfirmed: '' | ISO }`. Reads the on-disk snapshot and plans against the current org. Nothing is written.
- `POST /api/orgs/<slug>/sync/preview` with a JSON body → the same shape, planned from the body. The paste fallback. Nothing is written.
- `POST /api/orgs/<slug>/sync/apply` with `{ source: 'file', stamp }` or `{ source: 'json', json }`. Recomputes the plan server-side, never trusts a client plan. With `source: 'file'`, a `stamp` that no longer matches the file returns `409 { error: 'The snapshot changed. Review it again.' }`. Returns `{ ok, counts, errors, files }`.
- `PUT /api/orgs/<slug>/seats/<seat>/manager` with `{ reportsTo }`. Rejects the seat itself, a missing seat, and any target that would create a cycle. Rewrites the seat's `reportsTo` and the `org.md` chart line through `retargetSeat`, then appends an `edit` event "Moved <seat> under <manager>". Returns `{ ok, file }`.

All writes go through the existing serializers, which emit UTF-8 without a byte-order mark and LF line endings.

## 8. Sync panel

**Button.** `Button` variant secondary, label "Sync with Grok Bot", in the `org-sub` row beside the organization switcher. Template mode, editable org only. Hidden on templates and in showcase. When the current plan has at least one row that would write, the label becomes "Sync with Grok Bot · N" where N is that count.

**Live.** `use-run-log.ts` listens for the `grok` event and the Workspace refetches `GET .../sync`. The Workspace also refetches after any confirmed sync and when the drawer opens.

**Drawer.** Same `be-drawer be-hire` shell as Add existing bot. Three parts, top to bottom:

1. Status. "Snapshot from 22:10. Last confirmed 21:50." or "No snapshot yet. The Connector writes orgs/<slug>/grok/snapshot.json on each run." A broken snapshot shows its parse error. A link to the Connector prompt on Organization Overview.
2. Preview. Rows grouped under New, Not found in Grok Bot, Updated, New processes, and Schedule warnings, each group with its count. One line per row: the name and what changes, for example "Invoice Bot → link, 3 routines, last active 17 Oct 2026, 20:20". Unchanged rows are a single count line. Confirm is a primary `Button`, disabled when nothing would write. Cancel closes.
3. Fallback. "No snapshot? Ask Grok Bot for one." with `CopyPromptButton` for `GROK_SNAPSHOT_PROMPT` and an "Import snapshot file" file input that posts to the preview route and swaps the preview to that source. A "Sync now" nudge is a second copy-prompt: "Run the Connector - BotsEverywhere routine now."

**After confirm.** `rereadOrg`, the drawer closes, and a `SaveAlert` shows the summary line. Per-row errors are listed under it as "Skipped <name>: <reason>", matching the existing import wording.

**Tags.** On the org chart card a bot with `grokSync: new` shows a "New" tag and one with `grokSync: missing` shows "Not found in Grok Bot". The seat drawer Performance tab adds one line: "Grok Bot: synced 22:10", "new since 22:10", or "not found since 22:10".

## 9. Org chart editing: Reports to

In the seat drawer, editable mode, under the "Reports to" line: a native `<select>` labeled "Reports to" listing active seats except the seat itself and its descendants. Changing it calls the manager route, then `rereadOrg`. The chart redraws and the Connector reads the new `reportsTo` on its next run. Out of scope: renaming a seat from the app, drag and drop.

## 10. Error handling

- Snapshot missing: the panel explains and offers the fallback. Nothing else changes.
- Snapshot unreadable: the panel shows the parser's message, for example "This file is not JSON." The org is unaffected. The watcher logs the path once.
- A bot row without a name: skipped with the import's note. Everything else in the file still applies.
- One seat write fails during apply: the rest continue. The response lists each failure by name. The sync event records what was written.
- Writer down: the standard "Saving is off. Restart npm run dev." notice.
- Snapshot overwritten between preview and apply: 409, the panel refetches and shows the new preview.
- The sync never deletes a seat, retires a seat, changes an existing seat's manager, overwrites a filled card section, edits an existing process, or writes `grok/snapshot.json`.

## 11. Tests

`server/test/grok-sync.test.ts`:

- Snapshot with a byte-order mark and CRLF parses. Not JSON, no `bots` list, and a missing file each return an error and never throw.
- Plan: new, renamed by URL, updated with the exact facts that changed, unchanged, missing, missing then found again, humans and retired seats never flagged, empty section filled while a filled one is kept, `reportsTo` of an existing seat never taken from the snapshot, unknown manager on a new bot falls back to You with a note, two new bots reporting to each other resolve in two passes.
- Processes: new routine becomes a process file, existing process untouched, schedule difference becomes a warning row.
- Apply: files written without a byte-order mark and with LF, no seat file deleted or retired, applying the same snapshot twice writes nothing the second time, sync event appended once with the summary line, stale stamp returns 409.
- Manager route: self and cycle rejected, seat file and `org.md` agree afterwards and `validateBundle` passes, edit event appended.
- Watcher: `orgChange` maps `<slug>/grok/snapshot.json` to `{ slug, kind: 'grok' }`.
- Prompt: `connectorPrompt` names the snapshot path, the 15-minute schedule, and the "never edit" line.

Static checks in the style of `nav.test.ts`: the button label, that it renders only when editable, that the drawer and tags use `Button` and tokens, and that user-facing text says organization.

## 12. Docs

- `AGENTS.md`: add `grok/snapshot.json` to the org files list, the `grok` live event, and the new Connector lines.
- `docs/ARCHITECTURE.md` section 5: no longer a plan. Describe the folder protocol.
- `src/pages/DocsPage.tsx` `#connect-grok`: one paragraph on the Sync button and the fallback.

## 13. Out of scope

A sync channel faster than the Connector schedule. Renaming a seat from the app. Deleting anything. Flagging processes as missing. Grok Bot editing the app's files. Showcase mode. Sample organizations.
