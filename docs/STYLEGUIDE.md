# Style guide

Visual values live in one file: `src/styles/tokens.css`. It imports `brand-kit/v2/tokens.css` and then overrides the page background to white. Do not edit the brand kit file. Do not put a raw hex color in a component or in any other stylesheet.

`npm test` fails if a `.tsx` file sets a `style` prop, or if a hex color appears under `src/` outside `src/styles/tokens.css`.

## Color

| Token | Use |
| --- | --- |
| `--color-bg`, `--color-white` | Page and card surfaces |
| `--color-ink` | Text, primary buttons, rules that should read as black |
| `--color-muted` | Secondary text |
| `--color-line` | Hairlines |
| `--color-stone`, `--color-paper` | Quiet fills |
| `--color-link`, `--color-link-hover` | Text links |
| `--color-inverse` | Text on the black band |

Older screens still reference `--navy`, `--blue`, `--mint`, `--teal`, `--purple`, `--gray`, `--muted`, and `--border`. Those names alias the tokens above.

## Type

Inter, self-hosted. Meaningful text is at least `--text-sm` (14px). Meaning-carrying tags (step types, BOT) use `--tag-size` (12px), and 14px in present mode. Non-essential labels use `--text-2xs` (11px).

| Token | Size |
| --- | --- |
| `--text-2xs` | 11px, non-essential labels |
| `--text-tag` | 12px, step types and BOT |
| `--text-sm` | 14px |
| `--text-base` | 16px |
| `--text-lg` | 18px |
| `--text-3xl` | 32px |
| `--text-6xl` | 48px |
| `--text-7xl` | 56px |

Weights: `--weight-regular` 400, `--weight-medium` 500, `--weight-semibold` 600, `--weight-bold` 700.

Line heights: `--leading-tight`, `--leading-snug`, `--leading-title`, `--leading-body`.

## Spacing

The scale is `--space-1` through `--space-10` (4, 8, 12, 16, 24, 32, 48, 64, 96, 128).

| Token | Value | Use |
| --- | --- | --- |
| `--space-heading` | 12px | Heading to the line under it |
| `--space-cta` | 24px | That line to the button row |
| `--section-pad` | 64px | Marketing section padding |
| `--section-pad-sm` | 48px | The same sections below 900px |

Center a stacked heading, subline, and buttons as a column (`align-items: center; text-align: center`), not as loose inline buttons.

## Radius, line, shadow

- Radius: `--btn-radius` and `--control-radius` are 0. Buttons, inputs, chips, pills, the legend, zoom, and search are square. `--radius-sm` (2px) stays on cards and tags.
- Hairline: `--hairline` (`1px solid var(--color-line)`). Strong rule: `--border-strong`.
- Shadows: `--shadow` is none on the v3.2 surfaces. Overlay colors (`--overlay-blue-10` and the rest) are for older elevated panels.

## Z-index

`--z-sticky` 2, `--z-dropdown` 4, `--z-drawer` 20, `--z-nav` 40, `--z-menu` 50, `--z-modal` 80. The leave dialog stays above the org picker.

## Breakpoints

`--bp-mobile` 390, `--bp-app` 800, `--bp-nav` 900, `--bp-desktop` 1280. A media query cannot read a custom property, so the query repeats the number. The nav collapses into a drawer at 900px.

## Components

| Token | Value |
| --- | --- |
| `--btn-height` | 36px. One size. See `docs/design-tokens.md` |
| `--btn-bg` / `--btn-fg` | Ink on white |
| `--tag-size` | 12px (`--tag-size-present` is 14px) |
| `--card-border` | Hairline |
| `--nav-height` | 72px |
| `--logo-nav` | 28px lockup in the header. Icon and wordmark scale together. |

Classes `.btn`, `.card`, `.badge`, and `.site-nav` consume these. A bar that grows with data (hire progress, goal progress) sets the custom property `--meter` from a ref. It does not use a `style` prop. Org-chart zoom keeps tags and initials at or above `--org-tag-floor` (11px) and card text at or above `--org-body-floor` (12px).

## Adding a value

1. Add the custom property in `src/styles/tokens.css`.
2. Use `var(--…)` from a class.
3. Run `npm test` and confirm the hex check still passes.
