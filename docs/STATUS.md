# Status

Where the app stands as of 21 October 2026, written for whoever picks it up next. Facts about the running org describe Miguel's own `orgs/your-company`, which is uncommitted user data.

## Branches

The main branch is `main`. Everything since it sits on one straight line of branches, each one holding the one before. None is merged into `main`. Every branch matches its copy on `origin`.

| Branch | Adds on top of the one above |
| --- | --- |
| `main` | Initial commit, Delete an organization from the Options menu, retired imported bots stay retired. |
| `prompt-rules` | 2 commits. Delete an organization even when Windows holds its folder. Prompts say one Grok Bot account runs every bot, and a bot may sit in several organizations. |
| `feat/grok-delete` | 19 commits. Retired in the legend and Delete in Grok Bot. The Connector's last run time in the header, with a dropdown. **Runs every** on Connect bots, and the interval the Connector reports. Find seat, Add a seat by short name, Overview boxes that open their lists. |
| `performance-tracker` | 14 commits. Times used and Automated tasks done from the run log. In Grok Bot counts the whole Grok Bot account. Grok Bot's numbers apply on every Connector run. A requested bot pulses Connecting and links on its own. The light `GET /api/connector` endpoint. |
| `homepage-content` | 9 commits. Homepage copy, Sync drawer button layout, the Logs tab shows a retire at once. |

Decision pending from Miguel: how this line lands on `main`. Never push to `main` without his OK.

Design docs: `docs/superpowers/specs/` (sync, one Connector per project, retire and delete) and `docs/superpowers/plans/2026-10-17-grok-sync.md`.

## What works

- One Connector per copy, `Connector - BotsEverywhere (uft5)`, runs in Grok Bot every 17 minutes. It writes each org's `grok/snapshot.json` and `orgs/connector.json`.
- On every Connector run the writer applies Grok Bot's numbers to the seat files, links bots it was asked to create, and notices retired bots deleted in Grok Bot. Structure still waits for **Sync with Grok Bot**.
- The header badge shows the last run time and opens the sync details. Connect bots sets the interval.
- The org chart drags and zooms, colors bot cards by Grok Bot state, and finds a seat by name. The legend and Overview boxes open lists, including Retired.
- A seat's manager can be changed from the seat drawer.

## State of the running org

Read from `orgs/` on 21 October 2026 at about 15:00 local time.

- Organization name BotsEverywhere, slug `your-company`. Project id `uft5`, interval 17 minutes in both `project.json` and `connector.json`, so there is no interval warning.
- Last Connector run 14:56 local. Its snapshot lists 36 bots and 5 processes. `orgs/connector.json` lists no unassigned bots. `grok/requests.json` holds no requests.
- 32 active bot seats, all `grokSync: synced` with a Grok Bot link. One Connector seat, `connector-botseverywhere-uft5`; the two older Connector seats are gone.
- 3 active humans (You, Angel Rodriguez, Juan Delgado Marketing). One retired human seat, `grsgrf` titled "fhgtgf", which looks like a test seat.
- 10 retired bot seats:
  - Marked deleted in Grok Bot: `bug-bot`, `request-bot`, and `inbox-bot` with `inbox-bot-2`.
  - Retired with a link and not marked deleted, so **Delete in Grok Bot** is offered: `acceptance-bot`, `bookkeeping-bot`, `chief-of-staff-bot`, `policy-bot`, `support-bot`.
  - `bid-bot`: no link, `grokSync: missing`. It was never created in Grok Bot.
- 5 process files, no `-2` duplicates left.
- Last confirmed sync 20 October 2026, 23:19 local.
- Earlier, the Connector reported a GitHub token in plain text in one of Grok Bot's own files. Nothing under `orgs/` contains one. Whether it was rotated is not recorded here; rotate it if not.

## How to verify

```bash
npm test          # expect 1 failure on Windows: org-node-layout.test.ts needs Chrome at a Linux path
npm run build     # then: git checkout -- src/generated/bots.ts
npx playwright test e2e/org-chart-scroll.spec.ts e2e/owner-org-chart.spec.ts   # needs npm run dev running
```

The sync suites are `server/test/grok-sync.test.ts` and `server/test/sync-ui.test.ts`. The chart suite is `server/test/org-pan-zoom.test.ts`. The Connector suites are `server/test/connector-*.test.ts` and `server/test/project-connector.test.ts`.

## Known quirks

- `server/test/dev-ports.test.ts` can fail while a browser spec holds ports; it passes alone.
- A failed hot reload leaves the old module in the browser tab until a hard reload (F5). This cost an evening of confusion once already.
- The writer is `tsx` without a watcher. Any change under `server/src/` needs `npm run dev` restarted.
- VS Code marks the imports in `server/test/*.ts` as errors (TS5097 and TS2591) because no tsconfig includes `server/test/`. The tests run; `node --import tsx` does not type-check.
- A changed Connector prompt reaches Grok Bot only when it is pasted into the Connector again from Connect bots. Until then a new interval or new rule does nothing there.

## Deferred

Found in the sync review (17 to 18 October), graded minor, not done, and not rechecked since:

- A manager change through `retargetSeat` keeps a BOM or CRLF if the seat file came with one. Readers tolerate it.
- The apply route wraps a pasted snapshot in JSON, so a very large pasted file can preview but hit the 100 KB body limit on apply.
- Snapshot card lines starting with `#` are dropped, not only headings.
- A newline inside a routine step from a snapshot is not collapsed before `serializeProcess`.
- The drawer prefixes the writer-restart message with "The snapshot could not be read:".
- CSRF on the writer's state-changing routes is the same on every route: loopback bind, loopback-only CORS, no token. A whole-writer follow-up.
- The older `/bots-file` and `/seats/existing` routes still accept card lines that read as headings.

## Open questions

- README, SETUP, and Docs say the starter org is `orgs/your-company/`, but nothing under `orgs/` is in git, and `npm run dev` does not create it. A fresh clone may open to "That org is not on this computer". Ship a starter org, create one on first run, or change the docs.

## Next

Ideas raised and not built: apply a sync automatically instead of on Confirm.
