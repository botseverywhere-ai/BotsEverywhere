# Status

Where the app stands as of 18 October 2026, written for whoever picks it up next. Facts about the running org describe Miguel's own `orgs/your-company`, which is uncommitted user data.

## Branches

Three branches stack on `master`, none merged yet. The dev server runs from the checkout on the top one.

| Branch | What it holds |
| --- | --- |
| `fix/work-chart-honesty` | Process import skips duplicates instead of writing `-2` copies. Org chart cards count tasks from the run log. Run-log times are read in local time, not UTC. |
| `feat/grok-sync` | Sync with Grok Bot: snapshot contract, planner, writer routes, drawer, tags, Reports to select, docs. Reviewed by a fresh reviewer; all Important findings fixed. |
| `feat/org-chart-pan-zoom` | Drag to pan, wheel zoom around the pointer, the viewport keeps its own height, Grok Bot state on bot cards. |

Decision pending from Miguel: merge locally into `master`, open a pull request, or keep as is. Never push to `main` without his OK.

Design and plan for the sync: `docs/superpowers/specs/2026-10-17-grok-sync-design.md` and `docs/superpowers/plans/2026-10-17-grok-sync.md`.

## What works

- The Connector bot in Grok Bot runs every 15 minutes and writes `orgs/your-company/grok/snapshot.json`. It has done so twice on its own.
- **Sync with Grok Bot** on the org tab row shows a count when the snapshot has something to apply, previews the merge, and writes it on Confirm. Two syncs have been confirmed and are in the Logs tab.
- The org chart drags, zooms with the wheel and the buttons, and colors bot cards: green **In Grok Bot**, dashed **Not in Grok Bot**, muted **Not synced yet**.
- A seat's manager can be changed from the seat drawer.

## State of the running org

- 32 bot seats: 4 stamped `synced`, 26 with a Grok Bot link and no stamp (shown green through the link), 2 flagged `missing`: `metric-change-bot` and `search-brief-bot`, both hired from the directory and never created in Grok Bot.
- Two bots named Connector - BotsEverywhere exist in Grok Bot. Seat `connector-botseverywhere` points at yesterday's; seat `connector-botseverywhere-2` is the live one. Delete the old bot in Grok Bot, let the next snapshot flag the old seat, then retire that seat from its drawer.
- Four duplicate process files (`*-2.md`) still sit in `orgs/your-company/processes/`. Remove them by hand or with Delete on the Work Chart. The import that created them cannot happen again.
- The Connector reported a GitHub token in plain text in one of Grok Bot's own files. Nothing under `orgs/` contains one. Rotate it anyway.
- The writer inside Miguel's `npm run dev` predates the review fixes until it is restarted. Restarting it lets the next Confirm stamp the 26 linked bots with a real snapshot date.

## How to verify

```bash
npm test          # expect 1 failure: org-node-layout.test.ts needs Chrome at a Linux path
npm run build     # then: git checkout -- src/generated/bots.ts
npx playwright test e2e/org-chart-scroll.spec.ts e2e/owner-org-chart.spec.ts   # needs npm run dev running
```

The two sync suites are `server/test/grok-sync.test.ts` and `server/test/sync-ui.test.ts`. The chart suite is `server/test/org-pan-zoom.test.ts`.

## Known quirks

- `server/test/dev-ports.test.ts` can fail while a browser spec holds ports; it passes alone.
- A failed hot reload leaves the old module in the browser tab until a hard reload (F5). This cost an evening of confusion once already.
- The writer is `tsx` without a watcher. Any change under `server/src/` needs `npm run dev` restarted.

## Deferred

Found in review, graded minor, not done:

- A manager change through `retargetSeat` keeps a BOM or CRLF if the seat file came with one. Readers tolerate it.
- The apply route wraps a pasted snapshot in JSON, so a very large pasted file can preview but hit the 100 KB body limit on apply.
- Snapshot card lines starting with `#` are dropped, not only headings.
- A newline inside a routine step from a snapshot is not collapsed before `serializeProcess`.
- The drawer prefixes the writer-restart message with "The snapshot could not be read:".
- CSRF on the writer's state-changing routes is the same on every route: loopback bind, loopback-only CORS, no token. A whole-writer follow-up.
- The older `/bots-file` and `/seats/existing` routes still accept card lines that read as headings.

## Next

**Create in Grok Bot** is built on `feat/popup-notices` (see `AGENTS.md`, "Current status and next step"). To use it: restart `npm run dev` so the writer has the new route, and replace the Connector's prompt in Grok Bot with the one on the Connect bots tab so it reads `grok/requests.json`.

Ideas raised and not built: apply a sync automatically instead of on Confirm; one Connector handling several org folders.
