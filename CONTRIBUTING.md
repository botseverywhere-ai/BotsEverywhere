# Contributing to BotsEverywhere

Thank you for helping. This page says how to run the project, how to send a change, and what gets a change merged.

## Before you start

You need Node.js 22 or newer, npm, and git. A Grok Bot account is needed only to try the Connector; the app, the tests, and the build run without one.

```bash
git clone https://github.com/botseverywhere-ai/botseverywhere.git
cd botseverywhere
npm install
npm run dev
```

`npm run dev` starts the site at `http://127.0.0.1:5199` and the local file writer at `http://127.0.0.1:8787`. Your organizations live in `orgs/`, which git ignores. [SETUP.md](SETUP.md) has the full steps, including Windows PowerShell.

## How the project is organized

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the map: the two builds, the folders, and how the Connector moves data between the app and Grok Bot. [AGENTS.md](AGENTS.md) holds the working rules for anyone changing the code, and the hard rules at its end apply to every change. Read both before a change that touches more than one file.

## Making a change

1. **Open an issue first** for anything bigger than a typo or a small fix, so the direction is agreed before the work.
2. **Branch from `main`.** `main` is the only long-lived branch and is protected: nothing is pushed to it directly. Name the branch for the change, for example `fix/sync-stale-stamp` or `feat/work-chart-filter`.
3. **Keep the change small.** One change per pull request. No unrelated refactors, renames, or style edits in the same pull request.
4. **Write a test first** when the change has behavior: a failing test under `server/test/`, then the change that makes it pass. UI tests render components with `renderToStaticMarkup`; file readers are tested against files with a BOM, CRLF line endings, and bad content.
5. **Run the checks** before you push:

   ```bash
   npm test
   npm run lint
   npm run build
   ```

   One test, `org-node-layout.test.ts`, needs Chrome at `/usr/bin/google-chrome` (or `CHROME_PATH`) and skips itself without it. A run without Chrome shows 1 skipped.
6. **Open a pull request** against `main`. Say what changed and why, in plain words, and link the issue. CI runs the same checks on every pull request; it has to be green before review.

## What the review looks at

- The change does what the issue asked, and nothing else.
- User-facing text says **organization**, never company, and **open source**, never free template.
- Colors, type, spacing, and radius come from `src/styles/tokens.css`; buttons are `src/components/Button.tsx`; corners are square.
- Every reader of a file under `orgs/` tolerates a BOM, CRLF, and a bad file, and never crashes the writer or turns the app white.
- No API keys in the frontend, no personal data in the repository, nothing written outside `orgs/` by the writer.
- Tests cover the behavior, and the suite is green.

A maintainer merges the pull request. Squash merging keeps `main` at one commit per change.

## Reporting a bug

Open an issue with the bug report template: what you did, what you expected, what happened, your operating system and Node version, and a screenshot when the problem is on screen. Never paste a Grok Bot link, a token, or the contents of your `orgs/` folder into an issue.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) says how to report one privately.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE) that covers the project, without any additional terms or conditions.
