# BotsEverywhere

BotsEverywhere is an open source team management tool for bots.

Organizations copy it to map their team of people and bots in one place: an org chart, a work chart of who does what and when, and a directory of ready-made bots they can add to Grok Bot. Their data stays on their own computer.

There are no API keys in the frontend. BotsEverywhere is dual licensed under the [MIT License](LICENSE-MIT) or the [Apache License 2.0](LICENSE-APACHE), at your option. See [NOTICE](NOTICE) for credit.

Full install steps, including Windows PowerShell and an optional static host, are in [SETUP.md](SETUP.md). How the two builds, the folders, and the live-log plan fit together is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally

Template mode is the default.

```bash
npm install
npm run dev       # site on http://127.0.0.1:5199 and the file writer on http://127.0.0.1:8787
```

Open [http://127.0.0.1:5199](http://127.0.0.1:5199) and choose **Open your org** to create your first organization. `npm run dev` starts the site and the local file writer together.

## Where your data lives

Each org you create is a folder on this computer:

```
orgs/<slug>/org.md
orgs/<slug>/seats/<slug>.md
orgs/<slug>/work-chart.md
orgs/<slug>/processes/<slug>.md
orgs/<slug>/log/<event>.md
orgs/<slug>/grok/snapshot.json   written by the Connector bot in Grok Bot
orgs/connector.json              written by the Connector: when it last ran, and bots in no org
```

`directory/` stays at the repo root. It is the shared bot catalog, not part of an org. A save or a hire writes only inside the org folder you picked.

To keep your orgs in step with Grok Bot, copy the Connector prompt from the Connect bots tab and paste it into Grok Bot once. One Connector serves every org in this copy. It runs every 15 minutes unless you change **Runs every** on Connect bots, and writes each org's `grok/snapshot.json` and `orgs/connector.json`. Grok Bot's numbers reach Performance on every run. For new bots, missing bots, and routines, **Sync with Grok Bot** on the org tab row previews what changed and applies it when you confirm. Nothing is ever deleted by a sync. The current state of this work is in [docs/STATUS.md](docs/STATUS.md).

The writer root is `ORGS_DIR` (default `./orgs`). Nothing is uploaded. `orgs/` is ignored by git because it is your own data: to keep history, add it with `git add -f orgs` and push it only to a private repository, or use **Export** on the Backup tab. `samples/` stays read-only. A fresh clone has no organization until you create one.

Open `#docs` for the steps and `#directory` for the bot directory.

## Modes

| Mode | How to turn it on | What you get |
| --- | --- | --- |
| `template` | default | Your org files under `orgs/`. `npm run dev` starts the site and the file writer. |
| `showcase` | `VITE_APP_MODE=showcase` | Read-only directory for a public site such as botseverywhere.ai. Sample organizations and clone instructions. No create-team links and no file writer. |
| `sqlite` | `MODE=sqlite` and `VITE_APP_MODE=sqlite` | Optional share-link API kept from the earlier demo. Off unless you set the flag. |

Showcase does not start an API. SQLite is one command, `MODE=sqlite VITE_APP_MODE=sqlite npm run dev`. `AUTH_ENABLED` stays false unless you opt in. See SETUP.md.

## Files

```
orgs/<slug>/org.md
orgs/<slug>/seats/<slug>.md
orgs/<slug>/work-chart.md
orgs/<slug>/processes/<slug>.md
orgs/<slug>/log/<event>.md
orgs/<slug>/grok/snapshot.json
samples/<company>/        read-only templates (copied into orgs/<slug>/)
directory/                bot prompts, one markdown file per bot, plus PUBLISH-QUEUE.md
```

Seat frontmatter:

```markdown
---
title: Research
department: delivery
reportsTo: you
addToGrokBotUrl: ""
status: active
kind: bot
role: Briefs
personId: ""
hiredAt: ""
retiredAt: ""
directoryId: ""
---

## Owns
...

## May
...

## Needs approval
...

## Done when
...
```

`addToGrokBotUrl` must be empty or match `https://x.ai/bot/…`. Do not invent a link. When it is set, the seat card shows **Add to Grok Bot**. An empty link hides that button. Saving never deletes a seat file; retire the seat instead. Each log event is one file under `orgs/<slug>/log/`.

The static build loads these files with Vite `import.meta.glob`. The file writer binds to `127.0.0.1` only, refuses `NODE_ENV=production`, and is not part of the hosted site.

## Checks

```bash
npm run validate:org    # orgs/ and samples/*/
npm run validate:directory
npm run validate:bots   # curated bots/*.md catalog
npm test
npm run lint
npm run build
```

## Brand

The mark is the Org Bracket (option G). Files live in `brand-kit/v2/logo/final/` and are copied into `public/` (`lockup-ink.svg` in the nav at 26px and in the footer at 24px, `mark-favicon-ink.svg` at 32px and below). Do not recolor, stretch, or retype the outlined wordmark. The app style guide is `src/styles/tokens.css` (it imports `brand-kit/v2/tokens.css` and overrides the page background to white). See `docs/STYLEGUIDE.md`.

## License

Copyright 2026 Miguel Rovira.

Licensed under either of

- MIT License ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option. The BotsEverywhere name and logo are not licensed under either license.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in BotsEverywhere by you shall be dual licensed as above, without any additional terms or conditions.
