# One bot, one organization: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import every Grok Bot bot with who reports to whom, show bots already in another organization greyed with Move it here, Rename and publish in Grok Bot, Remove, and It's my main bot, and keep greyed bots out of everything that talks to Grok Bot.

**Architecture:** The Connector's dump (`orgs/grok-data.json`) gains each bot's own-text managers and the Connector's own id; the writer imports from it. A greyed seat is a normal seat file whose link sits in `elsewhereUrl` instead of `grokBotUrl`, so every link-based path ignores it, and one filter (`grokSeats`) keeps it out of the title-based ones. Actions on a greyed seat are writer functions with one route each; the page shows them in the seat panel.

**Tech Stack:** TypeScript, Node `http` writer (`server/src/template-server.ts`), React 19 + Vite, `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-29-one-bot-one-organization-design.md`

## Global Constraints

- User-facing text says organization, never company.
- Square corners; colors, type, space, and radius only from `src/styles/tokens.css`; buttons are `src/components/Button.tsx`; selects are native.
- Every org-file reader tolerates a UTF-8 BOM, CRLF, and a bad file; a bad file is skipped and never crashes the writer.
- A request about every organization reads each organization once (`orgReader`).
- The Connector reads only `orgs/` and never edits the app's files; new dump fields are optional; a dump without them still reads.
- The app never edits a bot's own text, only its block.
- `npm test` and `npm run build` pass before each commit. If `npm run build` changes `src/generated/bots.ts`, run `git checkout -- src/generated/bots.ts`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

- A dump from an older Connector, without `reportsTo` or `self`: the import still works, bots go under You, and the Connector's seat takes another organization's Connector link or none. Test in Task 6.
- A bot whose text names a manager that is not in the dump, or is misspelled: it goes under You with a note. Test in Task 5.
- A hand-edited seat file with both `elsewhereUrl` and `grokBotUrl`: it is a normal seat, not greyed. Test in Task 1.
- An organization renamed after a bot was greyed: the panel names the current name, because names are read live, never stored. Test in Task 8.
- A second click on Move it here or Remove for a seat that is no longer greyed: refused with "That seat is not greyed.", nothing changes. Test in Task 7.

---

### Task 1: Greyed-seat fields on seat files

**Files:**
- Modify: `server/src/org-files.ts` (`SeatDocument`, `parseSeatMarkdown`, `serializeSeat`, `serializeExistingSeat`, `metricLines`)
- Test: `server/test/greyed-seats.test.ts` (create)

**Interfaces:**
- Produces, in `server/src/org-files.ts`:
  - `SeatDocument.elsewhereUrl?: string`: the bot's Grok Bot link while it works for another organization. Set only on a greyed seat, whose `grokBotUrl` is empty.
  - `SeatDocument.waitsFor?: string`: slug of the greyed seat this seat's own text names as manager.
  - `SeatDocument.movedTo?: string`: organization id the bot moved to. Set only on a retired seat.
  - `export function isGreyed(seat: Pick<SeatDocument, 'elsewhereUrl' | 'grokBotUrl'>): boolean`: true when `elsewhereUrl` is non-empty and `grokBotUrl` is empty.
  - `export function grokSeats(seats: SeatDocument[]): SeatDocument[]`: the seats that are not greyed.
- `serializeExistingSeat` accepts `elsewhereUrl`, `waitsFor`, `movedTo`. All three are written by `metricLines`, so both seat formats keep them.

- [ ] **Step 1: Write the failing tests** in `greyed-seats.test.ts`:
  - `test('a greyed seat round-trips its link, waitsFor, and movedTo')`: `parseSeatMarkdown('research', serializeExistingSeat({ name: 'Research', grokBotUrl: '', elsewhereUrl: 'grokbot://app/v1/agent?id=r1', waitsFor: 'grok-bot', movedTo: 'org-abcd2345', reportsTo: 'you', owns: [], may: [], mustAskBefore: [], doneWhen: [] }))`. Assert that `ok` is true, `seat.elsewhereUrl === 'grokbot://app/v1/agent?id=r1'`, `seat.waitsFor === 'grok-bot'`, `seat.movedTo === 'org-abcd2345'`, and `isGreyed(seat) === true`.
  - `test('a seat with both links is not greyed, and grokSeats drops only greyed ones')`: `isGreyed({ elsewhereUrl: 'x', grokBotUrl: 'grokbot://app/v1/agent?id=r1' }) === false`. `grokSeats` over one greyed and one plain seat returns only the plain one.
- [ ] **Step 2:** Run `node --import tsx --test server/test/greyed-seats.test.ts`. Expected: FAIL (`isGreyed` is not exported).
- [ ] **Step 3:** Add the fields, the readers (in `parseSeatMarkdown`, beside `readSyncFields`), the writers (in `metricLines`), `isGreyed`, and `grokSeats`.
- [ ] **Step 4:** Run the test again. Expected: PASS. Then run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: "Seat files can hold a greyed bot's link, the seat it waits for, and where a bot moved".

### Task 2: The Connector reports managers and itself; the dump reads them

**Files:**
- Modify: `server/src/connector-prompt.ts` (`connectorGuide`), `server/src/grok-data.ts` (`GrokDataBot`, `GrokData`, `parseGrokData`, `rowFor`)
- Test: `server/test/connector-managers.test.ts` (create)

**Interfaces:**
- `GrokDataBot.reportsTo?: string` and `GrokDataBot.alsoReportsTo?: string[]`, from the bot's own text.
- `GrokData.self?: { id: string; name: string; grokBotUrl: string }`: the Connector itself.
- `export function rowsFromDump(data: GrokData, copyId: string, orgId: string): BotsFileRow[]`: one row per bot through `rowFor` (with `seats: []`), plus a row for `self` when present.
- `rowFor` uses `managerFromBlock(...) ?? bot.reportsTo ?? managerFromOwnerText(...) ?? 'You'`, and sets `alsoReportsTo` from `bot.alsoReportsTo` when the bot has no block for `orgId`.

- [ ] **Step 1: Write the failing tests:**
  - `test('CONNECTOR.md asks for each bot's own-text managers and for the Connector itself')`: `connectorGuide({ id: 'acn8', orgsFolder: '/o' })` includes `reportsTo and alsoReportsTo: who its own text, outside every "=== BotsEverywhere" block, says it reports to`, includes `"reportsTo": ""`, and includes `"self": { "id": ""`.
  - `test('the dump reads managers and self, and a dump without them still reads')`: `parseGrokData` on `{ dumpedAt: '2026-10-29T14:00:00+01:00', copy: 'acn8', bots: [{ id: 's1', name: 'Security', description: 'x', routinesVisible: false, reportsTo: 'Grok Bot', alsoReportsTo: ['Outer Loop'] }], skills: [], self: { id: 'c1', name: 'Connector - BotsEverywhere (acn8)', grokBotUrl: 'grokbot://app/v1/agent?id=c1' } }` gives `bots[0].reportsTo === 'Grok Bot'`, `bots[0].alsoReportsTo` deep-equal to `['Outer Loop']`, and `self.id === 'c1'`. The same object without those three fields gives `ok: true`.
  - `test('rowsFromDump names the manager from the bot's text and adds the Connector')`: the rows from the dump above include `{ name: 'Security', reportsTo: 'Grok Bot', alsoReportsTo: ['Outer Loop'] }` and a row named `Connector - BotsEverywhere (acn8)` with `grokBotUrl` `grokbot://app/v1/agent?id=c1`.
- [ ] **Step 2:** Run `node --import tsx --test server/test/connector-managers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add these lines to THE RUN step 2 in `connectorGuide`, with exactly this copy:
  - `   - reportsTo and alsoReportsTo: who its own text, outside every "=== BotsEverywhere" block, says it reports to, by that bot's exact name in Grok Bot, or You for the owner. A line like "<name> manages all <project> work" counts for a <project> bot. Leave both out when its text names no one.`
  - `   - self: your own id, name, and link.`

  Then add `"reportsTo": "", "alsoReportsTo": [""]` to the bot object in the format line, and add `"self": { "id": "", "name": "", "grokBotUrl": "" }` to the top level of the format line. Then add the parsing and `rowsFromDump`. A malformed `reportsTo`, `alsoReportsTo`, or `self` is dropped, never a refused dump.
- [ ] **Step 4:** Run the test again. Expected: PASS. Then run `npm test`. Expected: 0 fail. If `connector-guide.test.ts` pins the old format line, update it to the new line.
- [ ] **Step 5:** Commit: "The Connector reports each bot's own-text managers and itself".

### Task 3: The main bot in project.json

**Files:**
- Modify: `server/src/project.ts` (`writeProjectFile` and its callers)
- Test: `server/test/main-bot.test.ts` (create)

**Interfaces:**
- `export function readMainBot(orgsDir: string): string`: the main bot's Grok Bot id, or `''`.
- `export function writeMainBot(orgsDir: string, botId: string): { ok: true } | { ok: false; error: string }`.
- `writeProjectFile` keeps `mainBot` on every write, the way it keeps `removeCopies`.

- [ ] **Step 1: Write the failing test** `test('the main bot is saved by id and survives interval and remove-copy writes')`: `writeMainBot(dir, '19d8f3f9')`, then `writeSyncMinutes(dir, 30)`, then `writeRemoveCopy(dir, 'zz99')`. After all three, `readMainBot(dir) === '19d8f3f9'`. `writeMainBot(dir, '')` returns `ok: false`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: "project.json remembers the main bot by its Grok Bot id".

### Task 4: Greyed seats stay out of everything that talks to Grok Bot

**Files:**
- Modify: `server/src/connector-cycle.ts` (`runConnectorCycle`: the bundle pushed into `orgs`), `server/src/connector-log.ts` (the seats read near line 263), `server/src/template-server.ts` (the three `planSync` calls at `syncStatus`, `previewSnapshotJson`, the `sync/apply` route; `projectBots`; `grokAccount`), `server/src/grok-requests.ts` (`canDelete`)
- Test: `server/test/greyed-seats.test.ts`

**Interfaces:**
- Consumes `grokSeats` and `isGreyed` (Task 1).
- `canDelete` is false when `movedTo` is set.

- [ ] **Step 1: Write the failing tests:**
  - `test('a greyed seat gets no block, no snapshot row, and no sync match')`. Make org A with `Security` linked to `s1`, and org B with a greyed seat titled `Security` with `elsewhereUrl` `grokbot://app/v1/agent?id=s1`. Write a dump with bot `s1` named `Security`. After `runConnectorCycle(orgs, 'acn8')`:
    - No todo item's `description` contains `=== BotsEverywhere acn8 <B id> ===`.
    - B's `grok/snapshot.json` has no bot named `Security`.
    - `syncStatus(rootB, B, orgs)` has no plan row naming `Security`.
  - `test('a moved bot's retired seat offers no Delete in Grok Bot')`: `canDelete({ kind: 'bot', status: 'retired', grokBotUrl: 'grokbot://app/v1/agent?id=s1', movedTo: 'org-abcd2345' }) === false`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Hand `grokSeats(...)` to each listed call site instead of the bundle's full seat list, and update `canDelete`.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: "A greyed bot never gets a block, a snapshot row, or a Sync match".

### Task 5: Imports bring a bot active elsewhere in greyed

**Files:**
- Modify: `server/src/template-server.ts` (`ExistingBotInput`, `createExistingBot`, `importBotsFile`, `BotsFileResult`)
- Test: `server/test/one-org-per-bot.test.ts` (rewrite the third test; add new ones)

**Interfaces:**
- Consumes `botsInOtherOrgs`, `botKey`, `isConnectorName` (commit `be4a529`), `readMainBot` (Task 3), and the Task 1 fields.
- `ExistingBotInput.greyed?: boolean`: writes the link to `elsewhereUrl` and leaves `grokBotUrl` empty. `ExistingBotInput.waitsFor?: string`.
- `BotsFileResult.greyed: { name: string; slug: string; orgs: string[] }[]`.
- A bot whose key equals `readMainBot(orgsDir)` is never greyed and never refused, in the import or in `createExistingBot`.

- [ ] **Step 1: Write the failing tests:**
  - Replace `'importing many bots skips one active in another organization…'` with `test('importing brings a bot active elsewhere in greyed, and a bot naming it as manager waits under You')`. Rows `Research` (`r1`, active in A) and `Writer` (`w1`, `reportsTo: 'Research'`), imported into B:
    - `imported` lists both.
    - `greyed` deep-equals `[{ name: 'Research', slug: 'research', orgs: ['BotsEverywhere'] }]`.
    - `errors` is `[]`.
    - `writer.md` has `reportsTo: you` and `waitsFor: research`.
    - `research.md` has an empty `grokBotUrl` and `elsewhereUrl` `grokbot://app/v1/agent?id=r1`.
  - `test('the main bot is never greyed or refused')`: `writeMainBot(dir, 'main')`, with `Grok Bot` (`main`) active in A. `importBotsFile` into B gives an empty `greyed`, and `add(b, 'Grok Bot', 'main')` gives `ok: true`.
  - `test('a manager that is not in the file goes under You with a note')`: a row with `reportsTo: 'Nobody'` gives the note `Nobody is not a seat here; placed under You.`
- [ ] **Step 2:** Run `node --import tsx --test server/test/one-org-per-bot.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. In `importBotsFile`:
  - A bot active elsewhere becomes `greyed: true`. It is not skipped any more.
  - A row whose resolved manager is a greyed seat of this batch goes under You with `waitsFor` set to that seat.
  - A greyed row goes under its own named manager when that manager is active here; otherwise it goes under You with `waitsFor`.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: "Imports bring a bot active in another organization in greyed".

### Task 6: Import from the Connector

**Files:**
- Modify: `server/src/template-server.ts` (a new function and a new route)
- Test: `server/test/connector-import.test.ts` (create)

**Interfaces:**
- Consumes `rowsFromDump` (Task 2) and `importBotsFile` (Task 5).
- `export function importFromConnector(orgsDir: string, root: string, orgId: string): BotsFileResult | { error: string; status: number }`:
  - Rows come from `readGrokData`.
  - Seats are stamped `grokSync: 'synced'` and `grokSyncedAt: dumpedAt`.
  - The Connector's row takes its link from `self`. Without `self`, it takes the link of a seat whose title starts with `Connector - BotsEverywhere` in another organization. Without either, it has no link.
  - Answers `{ error: 'No data from the Connector yet.', status: 404 }` when there is no dump, and `{ error: IMPORT_LOCKED, status: 409 }` when `importLocked`.
- Route: `POST /api/orgs/<slug>/connector-import`, with no body. It answers 200 with the `BotsFileResult`, or the error status with `{ error }`.
- `importLocked(seats, mainBot = '')` and `orgImportLocked(seats, mainBot = '')` in `server/src/bots-file.ts` and `server/src/org-file.ts` don't count the seat linked to `mainBot`, just as they don't count the Connector. Every caller passes `readMainBot(orgsDir)`. The page passes `sync?.mainBot`.

- [ ] **Step 1: Write the failing tests:**
  - `test('the Connector import brings every bot with its own-text manager')`. A dump with `Grok Bot` (`g`), `Security` (`s`, `reportsTo: 'Grok Bot'`), and `self` `c1`, imported into an empty organization:
    - Seats exist for all three.
    - `security.md` has `reportsTo: grok-bot`.
    - The Connector's seat links `id=c1`.
  - `test('an older dump without managers or self still imports, under You')`: every bot has `reportsTo: you`.
  - `test('POST connector-import answers 404 with no dump and 409 once the organization has bots')`.
  - `test('the main bot does not lock the import')`: `importLocked` is false for seats You, the Connector, and a bot linked to `mainBot`. It is true once another bot is added.
- [ ] **Step 2:** Run `node --import tsx --test server/test/connector-import.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the function and the route. The route follows the `bots-file` route's checks.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: "Import from the Connector: every bot, with who it reports to".

### Task 7: Move it here, Rename and publish, Remove, It's my main bot

**Files:**
- Modify: `server/src/template-server.ts` (new functions and routes; `setSeatManager` and `setSeatManagers` clear `waitsFor`)
- Test: `server/test/greyed-actions.test.ts` (create)

**Interfaces:**
- Every function refuses with `{ ok: false, errors: ['That seat is not greyed.'] }` when `!isGreyed(seat)`.
- `export function moveBotHere(orgsDir: string, orgId: string, slug: string): { ok: true } | { ok: false; errors: string[] }`. In every other organization where the bot's key is active:
  - The bot's seat gets `status: retired`, `retiredAt` set to now, and `movedTo: orgId`.
  - Seats whose `reportsTo` is that seat move to that seat's manager, and it is removed from every `alsoReportsTo`.
  - One event is logged there: `Moved to <this organization's name>: <bot>`.

  Then the seat here is activated, and one event is logged here: `Moved here from <names>: <bot>`.
- `export function publishCopy(orgsDir: string, orgId: string, slug: string, name: string): …`. It sets the title to `name` and drops `elsewhereUrl`, then calls `requestGrokBot(root, orgId, slug, orgsDir)`. Its followers move as in activation. An empty name is refused with `Give the new bot a name.`
- `export function removeGreyedSeat(orgsDir: string, orgId: string, slug: string): …`. It deletes the seat file, removes the seat from `org.md`'s chart, and clears `waitsFor` on its followers. One event is logged: `Removed <bot>; it stays in <names>`.
- `export function markMainBot(orgsDir: string, orgId: string, slug: string): …`. It calls `writeMainBot` with the seat's key, then activates every greyed seat with that key in every organization. One event is logged: `<bot> is your main bot`.
- Activation, shared by the functions above: it moves `elsewhereUrl` into `grokBotUrl`. Every seat with `waitsFor === slug` whose `reportsTo` is still the default manager (`managerSeat`) moves under `slug`. Every follower's `waitsFor` is cleared.
- Routes: `POST /api/orgs/<slug>/seats/<seat>/move-here`; `POST /api/orgs/<slug>/seats/<seat>/publish` (body `{ name }`); `POST /api/orgs/<slug>/seats/<seat>/main-bot`; `DELETE /api/orgs/<slug>/seats/<seat>`. Each answers 200 `{ ok: true }`, or 422 `{ errors }`. Each also applies the loopback-origin check and the JSON-only check of `grok/requests`.

- [ ] **Step 1: Write the failing tests:**
  - `test('Move it here retires the bot elsewhere, re-points its reports there, and pulls its waiting reports under it here')`:
    - Org A: `Inner Loop` (`i1`) under You, and `Security` under `inner-loop`.
    - Org B, after an import of `Inner Loop` and `UX` (`reportsTo: 'Inner Loop'`): `inner-loop` is greyed, and `ux` is under You and waits for it.
    - After `moveBotHere(orgs, B, 'inner-loop')`:
      - A's `inner-loop` has `status: retired` and `movedTo: <B>`.
      - A's `security` has `reportsTo: you`.
      - B's `inner-loop` has `grokBotUrl` with `id=i1` and no `elsewhereUrl`.
      - B's `ux` has `reportsTo: inner-loop` and no `waitsFor`.
  - `test('a seat the owner moved stays where the owner put it')`: move `ux` under another seat with `setSeatManagers` before `moveBotHere`. It stays there.
  - `test('Rename and publish renames the seat and asks the Connector to create it')`: `publishCopy(orgs, B, 'research', 'Research - Alicante Tech Vibes')` leads to `readRequests(rootB).requests[0].name === 'Research - Alicante Tech Vibes'` and an empty `elsewhereUrl` on the seat.
  - `test('Remove deletes only the greyed seat')`: the file is gone, the chart no longer lists it, and the bot's seat in A is untouched.
  - `test('It's my main bot saves the id and activates its greyed seats everywhere')`.
  - `test('a second click is refused and changes nothing')`: calling `moveBotHere` twice gives `That seat is not greyed.` the second time.
- [ ] **Step 2:** Run `node --import tsx --test server/test/greyed-actions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions and routes.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: "Greyed bots: Move it here, Rename and publish in Grok Bot, Remove, It's my main bot".

### Task 8: The sync status says where each greyed bot works, and which bot is main

**Files:**
- Modify: `server/src/grok-sync.ts` (`SyncStatus`), `server/src/template-server.ts` (`syncStatus`)
- Test: `server/test/greyed-seats.test.ts`

**Interfaces:**
- `SyncStatus.elsewhere?: Record<string, string[]>`: greyed seat slug → names of the organizations where its bot is active. It is read live with the request's one `orgReader`.
- `SyncStatus.mainBot?: string`: `readMainBot(orgsDir)`.

- [ ] **Step 1: Write the failing test** `test('the sync status names the organizations of a greyed bot by their current name')`. Grey `research` in B while the bot is active in A. Rename A to `Renamed Org` with `writeOrgProfile`. Then `syncStatus(...).status.elsewhere` deep-equals `{ research: ['Renamed Org'] }`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 fail.
- [ ] **Step 5:** Commit: "The sync status names where each greyed bot works".

### Task 9: The page: greyed cards, the seat panel's choices, and the one-button import

**Files:**
- Create: `src/components/GreyedSeatBox.tsx`
- Modify:
  - `src/data/mock-companies.ts` (`Seat.elsewhere?: boolean`)
  - `src/org/company.ts` (set `elsewhere` from `isGreyed`)
  - `src/components/sync-copy.ts`
  - `src/components/OrgChart.tsx` (prop `elsewhere?: Record<string, string[]>`)
  - `src/components/SeatDrawer.tsx` (prop `greyed`)
  - `src/pages/Workspace.tsx` (handlers; skip greyed seats in `metricsById` and in the Performance table)
  - `src/components/LinkCompany.tsx` and `src/pages/CompanyOverview.tsx` (prop `connectorRan: boolean`)
  - `src/styles/app.css`
- Test: `server/test/greyed-ui.test.ts` (create)

**Interfaces:**
- In `sync-copy.ts`: `export function elsewhereTag(orgs: string[]): string`. It returns `In ${names}`, where names are joined as `A`, `A and B`, or `A, B, and C`.
- In `sync-copy.ts`: `export function greyedLine(bot: string, orgs: string[]): string`. It returns `${bot} is used in ${names}. A bot works for one organization.`
- The `SeatDrawer` prop `greyed?: { orgs: string[]; canMarkMain: boolean; onMove: () => void; onPublish: (name: string) => void; onRemove: () => void; onMainBot: () => void }`. When it is set, the panel shows `GreyedSeatBox` instead of the tabs.
- `GreyedSeatBox` copy, exactly:
  - The heading is `greyedLine`.
  - **Move it here**, with the line `Takes it out of <names> and makes it work here.`
  - A name field labeled `New name`, filled in with `<Bot> - <Organization>`, and the button **Rename and publish in Grok Bot**.
  - **Remove**, with the line `Takes this seat off the chart. The bot stays in <names>.`
  - **It's my main bot**, shown only when `canMarkMain` is true, with the line `Your main bot works in every organization.`
- The org chart card for a greyed seat: class `is-elsewhere` (dashed and muted, from tokens), and the tag `elsewhereTag(orgs)`.
- Connect bots, Option 1, when `connectorRan` is true: a primary button **Import from the Connector**, above today's prompt. Beside it, the line `Every bot comes in with who it reports to. Bots already in another organization come in greyed.` After an import, the line `<N> bots added. <M> are greyed: they work in another organization.`

- [ ] **Step 1: Write the failing tests:**
  - `test('greyed copy')`. Assert that:
    - `elsewhereTag(['BotsEverywhere']) === 'In BotsEverywhere'`.
    - `elsewhereTag(['A', 'B', 'C']) === 'In A, B, and C'`.
    - `greyedLine('Research', ['BotsEverywhere']) === 'Research is used in BotsEverywhere. A bot works for one organization.'`
  - `test('the seat panel shows the four choices and the chart greys the card')`. Read the source files and assert that:
    - `GreyedSeatBox.tsx` matches `>Move it here</Button>`, `>Rename and publish in Grok Bot</Button>`, `>Remove</Button>`, and `>It's my main bot</Button>`.
    - `OrgChart.tsx` matches `is-elsewhere`.
    - `Workspace.tsx` matches `/seats/${slug}/move-here`.
    - `LinkCompany.tsx` matches `Import from the Connector`.
- [ ] **Step 2:** Run `node --import tsx --test server/test/greyed-ui.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. After each action, the Workspace handler calls `rereadOrg()` and `loadSync()` and tells the result through `saveNotice`.
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test` and `npm run build`. Expected: 0 fail, and a clean build.
- [ ] **Step 5:** Commit: "Greyed bots on the org chart, their choices in the seat panel, and Import from the Connector".

### Task 10: Bots report only the skills they use

**Files:**
- Modify: `server/src/profile-reports.ts` (`profileForm`), `src/components/BotProfile.tsx` (the skills caption)
- Test: `server/test/profile-reports.test.ts`

- [ ] **Step 1: Write the failing test** `test('the profile form asks for skills the bot uses, not every skill turned on')`. `profileForm('org-x', 'seat')` includes `- <private skill you use in your work; leave out skills you only have turned on> | <what it does, in one line>`. It does not include `turned on for you`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Change the form line. Change BotProfile's caption `Turned on in Grok Bot, as the bot reported them.` to `Used in its work, as the bot reported them.`
- [ ] **Step 4:** Run it again. Expected: PASS. Then run `npm test`. Expected: 0 fail. Update any test that pins the old caption.
- [ ] **Step 5:** Commit: "Bots report the skills they use, not every skill turned on".

### Task 11: AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1:** Add a short section, **One bot, one organization**. It covers:
  - The rule, and its two exceptions.
  - `elsewhereUrl`, `waitsFor`, and `movedTo` on seats.
  - `mainBot` in `project.json`.
  - The new dump fields and the CONNECTOR.md rules.
  - Import from the Connector.
  - The four greyed choices and their routes.
  - That `grokSeats` keeps greyed seats out of blocks, snapshots, and Sync.

  Also add `profiles/` to the list of folders the writer watches.
- [ ] **Step 2:** Run `npm test` and `npm run build`. Expected: 0 fail, and a clean build.
- [ ] **Step 3:** Commit: "AGENTS.md: one bot, one organization".
