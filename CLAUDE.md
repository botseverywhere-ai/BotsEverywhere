See AGENTS.md

## Hard rules

- Change only what was asked. No unrequested terefactors, copy edits, or style edits.
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
