# Design tokens

`src/styles/tokens.css` is the only source for color, type, spacing, radius, borders, shadows, the focus ring, and buttons. Components do not set those values themselves. Raw hex stays in that file.

The shared control is `Button` in `src/components/Button.tsx`. It renders one size and one of three variants. Every action uses it: the header **Open your org**, **Use this template**, back links, **Add**, **Add to Grok Bot**, **Copy prompt**, **Hire**, **Hire into team**, drawer and dialog actions, Docs-adjacent calls to action, and the same actions on older screens.

## Button

| Token | Value |
| --- | --- |
| `--btn-height` | 36px |
| `--btn-font-size` | `--text-sm` (14px) |
| `--btn-pad-y` / `--btn-pad-x` | 8px / 16px |
| `--btn-radius` | `0`. Buttons are square. |
| `--btn-weight` | `--weight-medium` (500) |
| `--btn-primary-bg` / `--btn-primary-fg` | ink / white |
| `--btn-secondary-bg` / `--btn-secondary-fg` / `--btn-secondary-border` | white / ink / ink |
| `--btn-ghost-bg` / `--btn-ghost-fg` / `--btn-ghost-border` | white / ink / ink |
| `--btn-disabled-bg` / `--btn-disabled-fg` / `--btn-disabled-border` | paper / muted / line |
| `--focus-ring` | 2px solid ink |
| `--focus-ring-offset` | 2px |

| Variant | Look |
| --- | --- |
| `primary` | Black fill, white text |
| `secondary` | Outlined |
| `ghost` | Outlined back control. Pass `back` to draw the left arrow |

```tsx
<Button variant="primary" href="#/orgs">Open your org</Button>
<Button variant="secondary">Hire into team</Button>
<Button variant="ghost" back href="#directory">Back to all bots</Button>
```

`className` is only for placement (`template-use`, `site-nav-cta`, `dir-add`, `btn-block`). It does not set color, size, or radius.

Chart steps, tabs, chips, search clear, and the hire-drawer close mark are not this button. A new `<button>` in `src/` fails `server/test/button.test.ts` unless it is one of those existing controls.

## Color, type, space

Colors, the type scale, and the spacing scale are listed in `docs/STYLEGUIDE.md`. Buttons read them only through the tokens above.

## Radius, border, shadow

| Token | Value |
| --- | --- |
| `--btn-radius` | 0, every button |
| `--control-radius` | 0, inputs, chips, pills, the legend, zoom, search, and avatars inside buttons |
| `--radius-sm` | 2px, cards and tags that are not controls |
| `--radius-compact` | 0 |
| `--radius-md` | 8px |
| `--radius-lg` | 12px |
| `--radius-pill` | full pill. Controls do not use it. |
| `--hairline` | 1px solid `--color-line` |
| `--border-strong` | 1px solid `--color-ink` |
| `--shadow` | none on the current surfaces |
