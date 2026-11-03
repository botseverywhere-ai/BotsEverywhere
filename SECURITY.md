# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: open the repository's **Security** tab, choose **Report a vulnerability**, and describe what you found, how to reproduce it, and what it could expose. You will get an answer within seven days, and a fix or a plan within thirty days for a confirmed problem. Please give us that time before you publish anything.

## What is in scope

- The local app: the site and the file writer started by `npm run dev`.
- The showcase build.
- The Connector rules the app writes to `orgs/CONNECTOR.md`, and the files the app and the Connector exchange under `orgs/`.
- The bot directory and the templates that ship in this repository.

Grok Bot itself is not in scope here; report problems in Grok Bot to its maker.

## What to know about the design

- The app runs on your own computer. The file writer binds to `127.0.0.1` only, refuses other hosts, refuses to start when `NODE_ENV=production`, and writes only inside your `orgs/` folder.
- There are no accounts, no API keys in the frontend, and no telemetry. Nothing is uploaded.
- Routes that lead to a message or a change in Grok Bot accept requests only from this computer and only as JSON, so a page on another site cannot trigger them.
- The Connector never reads outside `orgs/`, never edits the app's files, and sends a bot only the text the app wrote for it.
- Your organizations, logs, profiles, and the Connector's files are all under `orgs/`, which git ignores. Never commit that folder to a public repository.

## Keeping your copy safe

- Keep tokens, keys, and private links out of every org file, seat card, process, and skill: the Connector copies that text into your bots' instructions in Grok Bot.
- Update with `git pull` in the folder you already use, so you get fixes without starting a second Connector.
