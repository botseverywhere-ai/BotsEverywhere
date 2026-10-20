# BotsEverywhere

Open source team management tool for bots. It runs on this computer. Template mode and showcase mode have no logins. [botseverywhere.ai](https://botseverywhere.ai) is the read-only showcase.

Two modes (`src/mode.ts`):

- **template** (default). Local org files under `orgs/`. `npm run dev` starts the site and the file writer. The UI writes through that writer (`canEditFiles` is true only in dev template mode).
- **showcase**. `VITE_APP_MODE=showcase`. Read-only sample organizations, directory, and docs. The public site.

`sqlite` in the same file is a separate share-link API. Leave it off. The writer (`server/src/index.ts`) listens only when `MODE` is `template` (the default). `MODE=showcase` does not start an API.

## Stack and commands

Vite, React 19, TypeScript. The local writer is Node in `server/src/template-server.ts` and binds to `127.0.0.1` only. `server/src/app.ts` is the sqlite app, not the file writer.

```bash
npm install
npm run dev
```

`scripts/dev-all.ts` prints the URLs it bound. Defaults are the site at `http://127.0.0.1:5199` and the writer at `http://127.0.0.1:8787` (`scripts/dev-ports.ts`). If a port is taken, the writer walks forward from 8787 (up to 20 tries) and the site takes the next free port from 5199, skipping the writer port. `PORT` and `WEB_PORT` override those starts.

```bash
npm test          # node --import tsx --test server/test/*.test.ts
npm run build     # validate orgs, directory, and mocks; generate bots; tsc; vite build; tsc -p server
```

`npm test` does not filter on extra arguments. To run one file: `node --import tsx --test server/test/<file>.test.ts`.

Two things to know before reading a red run as a regression. `server/test/org-node-layout.test.ts` launches Chrome at a Linux path and fails on a Windows machine without it. `npm run build` regenerates `src/generated/bots.ts` from `bots/*.md`, and the committed file has drifted from that source; run `git checkout -- src/generated/bots.ts` after a build unless the change is about that file. The writer is started by `tsx` without a watcher, so a change under `server/src/` needs `npm run dev` restarted. A failed hot reload (Vite error overlay) leaves the old module in the tab until a hard reload.

## Folder map

- `src/pages/` — screens. `Landing.tsx` (home), `DemoHome.tsx` (templates), `DocsPage.tsx`, `DirectoryPage.tsx`, `Workspace.tsx` (org tabs), `CompanyOverview.tsx` (Organization Overview).
- `src/components/` — UI. `OrgChart.tsx`, `ProcessChart.tsx`, `Button.tsx`, `AppFooter.tsx`, `LinkCompany.tsx`, `ConnectGrok.tsx`, `TabBoundary.tsx`.
- `src/styles/tokens.css` — color, type, space, radius, buttons, select chevron. It imports `brand-kit/v2/tokens.css`. Do not edit the brand-kit tokens file.
- `server/src/` — writer, parsers, live watcher (`live-hub.ts`).
- `server/test/` — tests.
- `brand-kit/v2/logo/final/` — logo masters (SVG and PNG).
- `public/` — files the site serves, including `lockup-ink.svg`, `mark-ink.svg`, `mark-favicon-ink.svg`.
- `directory/` — one markdown file per directory bot.
- `samples/` — read-only sample organizations.
- `docs/` — product docs. Bots JSON is `docs/bots-file.md`. The prompt string is `src/content/grok-bots-prompt.ts`.

## Org files

`orgs/<slug>/` (writer root `ORGS_DIR`, default `orgs`):

- `org.md` — YAML frontmatter (`name`, `description`, `industry`, `size`, `people`, `bots`, optional `fallbackProcess`, `mark`, `markColor`) then purpose text, `## Departments`, `## People`, `## Chart` (`- <seat>` or `- <seat>: <reportsTo>`). A file with `## Chart` is a markdown org.
- `seats/<slug>.md` — frontmatter: `title`, `department`, `reportsTo`, `addToGrokBotUrl`, `status` (`active` or `retired`), `kind` (`human`, `bot`, or `system`), `role`, optional `description`, `personId`, `hiredAt`, `retiredAt`, `directoryId`. Body sections: `## Owns`, `## May`, `## Needs approval`, `## Done when`.
- `work-chart.md` — triggers, workstreams, steps, handoffs, checkpoints.
- `processes/<slug>.md` — frontmatter `name`, `trigger` (`schedule`, `event`, or `manual`), `schedule` or `source`, `description`, `doneWhen`, optional `next`. Body: `## Steps` as `- <seat> | <action>`, then `## Notes`.
- `log/YYYY-MM-DD.md` — daily run log. Header `# Run log YYYY-MM-DD`. One line, six fields split on ` | `:

  `- HH:MM | bot | process | step | done|failed|skipped|waiting|running | note or -`

  Bad lines are skipped. The header is not a line.
- `log/<event>.md` — one activity event (hire, fire, edit, work, approval, exception) with YAML frontmatter (`id`, `type`, `actorSeatId`, `actorType`, `timestamp`) and the summary as the body. A `YYYY-MM-DD.md` name is a run log, not an event.
- `grok/snapshot.json` — written by the Connector on each run. One object: `syncedAt`, `bots` (the bots-file format), `processes` (the processes-file format). The app never writes it. A broken snapshot is reported in the Sync drawer and never breaks the org.

The writer watches `log/`, `processes/`, `grok/`, `seats/*.md`, and `org.md` and pushes SSE on `GET /api/orgs/<slug>/live` (`event: log`, `event: processes`, `event: grok`, `event: org`).

## Bots JSON

Import and export use `botseverywhere-bots.json` (`docs/bots-file.md`, parser `server/src/bots-file.ts`). One object, key `bots`. Each bot: `name` (required), optional `grokBotUrl`, `reportsTo` (defaults to You), `owns`, `may`, `needsApproval`, `doneWhen`, and performance fields `createdAt`, `lastActive`, `runs30d`, `tasksDone30d`, `routines` (`name`, `schedule` or `trigger`, optional `lastRun`), `status` (`active`, `paused`, or `retired`). Unknown numbers and dates are dropped with a note. `status` is stored as seat frontmatter `botStatus`, not seat `status`. Prompt rule: if a value is unknown, leave the field out. Never estimate or invent numbers.

## Connector

The bot name is `Connector - BotsEverywhere`. Its run-log bot field is `Connector`. The prompt is `connectorPrompt` in `server/src/connector-prompt.ts`. The UI shows it on the Connect bots tab (`src/components/ConnectGrok.tsx`) and in Docs (`#connect-grok`).

The Connector writes `grok/snapshot.json` every run, reads `grok/requests.json`, and never edits the app's files. **Sync with Grok Bot** on the org tab row (`src/components/SyncDrawer.tsx`) previews the merge (`GET /api/orgs/<slug>/sync`) and applies it (`POST .../sync/apply`; `POST .../sync/preview` takes a pasted file). The plan is pure, in `server/src/grok-sync.ts`. The app owns `reportsTo`, step assignments, and filled card sections; Grok Bot owns the link, routines, run numbers, and whether a bot exists. A sync never deletes a seat: a bot missing from Grok Bot is tagged `grokSync: missing`. Seat frontmatter carries `grokSync`, `grokSyncedAt`, and `grokMissingSince`. `PUT /api/orgs/<slug>/seats/<seat>/manager` moves a seat and refuses cycles.

## Org chart

`src/components/OrgChart.tsx`. The viewport keeps its own height (`.org-viewport` is `flex: 0 0 auto`) and scrolls natively. A mouse drag on the background pans under pointer capture; the plain wheel zooms around the pointer; the segmented control (−, readout, +, Fit) and pinch zoom too. The resize observer watches the border box, so scrollbars appearing or vanishing never re-fit. Zoom helpers live in `src/components/org-zoom.ts`.

On an org of your own (`grokStates={editable}`), a bot card shows its Grok Bot state from `src/components/sync-copy.ts`: green bar and **In Grok Bot** when the last sync saw it or when it carries a `grokBotUrl` link; **New in Grok Bot** when a sync created it; dashed and muted **Not in Grok Bot** when a snapshot lacked it (`grokSync: missing`); muted **Not synced yet** when nothing is known. Templates and samples stay plain. The seat drawer has a **Reports to** select (`PUT /api/orgs/<slug>/seats/<seat>/manager`), which refuses the seat itself and any cycle.

## Current status and next step

Status, branch stack, the state of Miguel's own org, known quirks, and deferred items: `docs/STATUS.md`. Three branches stack on `master` and are not merged: `fix/work-chart-honesty`, `feat/grok-sync`, `feat/org-chart-pan-zoom`. The dev server runs from the checkout on the top one. Miguel decides how they land.

Built: **Create in Grok Bot**. A bot card that says **Not in Grok Bot** or **Not synced yet** shows the button in the seat drawer. `POST /api/orgs/<slug>/grok/requests` (`{ "seat": "<slug>" }`) writes `orgs/<slug>/grok/requests.json` (`server/src/grok-requests.ts`): one entry per seat with `seat`, `name`, the absolute `seatFile`, `prompt`, the text of `directory/<directoryId>.md` below its frontmatter when it exists (inline, because the Connector never reads outside `orgs/`), and `requestedAt`. The seat file is not touched. Step 1 of the Connector prompt reads the file and creates each bot named exactly `name`. On each Connector run (`recordConnectorRun`), and on a confirmed sync from the Connector's snapshot, a requested seat the snapshot matched gets its link written (`applyPerformance` with the requested set), its request dropped, and a Created in Grok Bot line (`clearFulfilledRequests`); a pasted file never clears requests. Until then its Performance row pulses Connecting. `GET .../sync` carries `requests`, and the drawer says when the Connector was asked. The Connector bot already running in Grok Bot needs its prompt replaced once from the Connect bots tab to learn step 1.

The Sync drawer has two sides. **Coming from Grok Bot** is the snapshot plan. **Going to Grok Bot** lists requests waiting for the Connector and bots not in Grok Bot as checkboxes; **Sync** applies the incoming plan, then posts a request for each ticked bot. Activity events carry an optional `grok: in|out` frontmatter field (a sync writes `in`, a request writes `out`); the Logs tab shows it as a From Grok Bot or To Grok Bot badge, and older `sync-` events count as `in`.

Built: on every Connector run, `applyPerformance` (template-server) writes rows that change nothing but Grok Bot's numbers (`performanceOnly` in grok-sync: last active, runs, tasks, routines, created date) straight to the seat files, so Performance never waits for Sync; everything else still waits in the drawer. Ideas raised and not built: apply the whole sync automatically; one Connector handling several org folders.

## Hard rules

- Change only what was asked. No unrequested refactors, copy edits, or style edits.
- Small commits on a branch. Never push to `main` without Miguel's OK.
- User-facing text says organization, never company. Paths, routes (`#/org/...`), and `orgs/` stay as they are.
- User-facing text says open source, never free template.
- Square corners. `--control-radius` is `0` in `src/styles/tokens.css`. The exception is Docs code blocks: `.docs .code-block` uses `--radius-md` (8px).
- Colors, type, space, and radius come from `src/styles/tokens.css`. Buttons are `src/components/Button.tsx`. Selects are a native `<select>`; the chevron is `--select-chevron` in `tokens.css`.
- The big footer (`AppFooter` variant `public`) is only on the home page, the directory, templates (`#/templates`), and Docs. Org views use the compact footer.
- The import section (`LinkCompany`, “How to link your organization to BotsEverywhere”) and Connect to Grok Bot are only on the Connect bots tab (`#/org/<slug>/connect-bots`). Backup is its own tab (`#/org/<slug>/backup`). Organization Overview holds the organization fields only. A new org opens `#/org/<slug>/overview`. Templates show neither Connect bots nor Backup.
- No API keys in the frontend. Public env values are `VITE_APP_MODE`, `VITE_REPO_URL`, and `VITE_WRITER_PORT`.
- The logo is locked. Do not redraw, recolor, or replace files in `brand-kit/v2/logo/final/` or the copies in `public/` (`lockup-ink.svg`, the mark SVGs, and the PNGs `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `og-image.png`, `icon-maskable-512.png`).
- Every org-file reader must tolerate a UTF-8 BOM, CRLF, and a bad file. A bad file is skipped. It must not crash the writer, the watcher, or turn the app white. `server/src/normalize-text.ts` strips one leading BOM and normalizes CRLF. Dated run logs and files without frontmatter are not events. The watcher logs a bad path once.
- Run `npm test` and `npm run build` before committing.
