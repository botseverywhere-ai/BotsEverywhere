# One Connector per project

Date: 18 October 2026. Approved in chat by Miguel.

## Why

One Grok Bot account should need one Connector, not one per organization. People keep several copies of BotsEverywhere on one computer, so each copy's Connector must be told apart in Grok Bot, and each copy must hand out its own folder. Without a running Connector nothing reaches Grok Bot, so the app says so on every org page, but never blocks work.

## What changes

- **Project id.** The writer creates a short id (4 characters, `[a-z2-9]` without look-alikes) the first time it starts and saves it in `orgs/project.json` (`{ "id": "k3f9" }`). The app owns the file. A missing or bad file gets a fresh id written; it never crashes the writer.
- **Connector name.** `Connector - BotsEverywhere (<id>)`. The run-log bot field stays `Connector`.
- **Connector prompt** names the absolute `orgs` folder of this copy, built when the person copies it. On each run the Connector goes through every folder in `orgs/` that has an `org.md`. For each org: create the bots listed in `grok/requests.json`, write that org's `grok/snapshot.json` with only the bots that belong to it, and keep the routines and run-log rules as before. A bot belongs to an org when it was created from that org's requests, when its link matches a seat there, or when its name matches a seat title there (or `title · org name`). Each bot goes in at most one org. Bots that belong to no org go in `orgs/connector.json` (`{ "syncedAt", "unassigned": [bots] }`), which the Connector overwrites every run. It never reads or writes outside `orgs/`.
- **Connection status** comes from the modified time of `orgs/connector.json`, else the org's snapshot (older per-org Connectors). The bar shows the project folder, the Connector name, and the org folder.
- **Unassigned bots.** The Sync drawer of any org lists them under "In Grok Bot, no organization" as checkboxes; Sync adds the ticked ones to this org as seats marked New.
- **Duplicates.** When the app asks the Connector to create a bot whose title is an active bot seat in another org of the project, the request name becomes `Title · Org name`, and the drawer says so. The sync matches that name back to the seat.
- **50-bot note** counts active bot seats across every org in the project.
- **Folder** always comes from the writer. The editable folder box and its browser memory go away, because every copy on `127.0.0.1:5199` shares that memory.
- **Connect bots tab**: Step 1 Connect Grok Bot (name, folder, status, Copy Connector prompt, prompt folded away). Step 2 How to link your organization to BotsEverywhere (Options 1–3).
- **Docs**: Connect to Grok Bot moves right after install as Step 1 and explains the folder, the id, several copies, duplicates, unassigned bots, and the limit.

## Calls made by the builder

- `connector.json` doubles as the heartbeat and the unassigned list, so the Connector writes one extra file, not two.
- The Connector is not listed in any org's snapshot. An existing `connector-botseverywhere` seat will show Not in Grok Bot after the first new run; retire it from its drawer.
- The live watcher sends a `grok` event to every open org when `orgs/connector.json` or `orgs/project.json` changes.
