# commitcard — design system

Ground truth for the built world. The web app (`index.html`) and the card renderer
(`src/render.mjs`) are two frontends over one visual language.

## Visual world: GitHub Primer

Pinned by the user. Do not re-derive or drift toward another system.

- **Tokens** — Primer light and dark, both first-class. The page sets `data-theme` on
  `<html>`; light and dark are the same token names with different values.
- **Type** — GitHub's system stack: `-apple-system, BlinkMacSystemFont, "Segoe UI",
  "Noto Sans", Helvetica, Arial`. Mono is `ui-monospace, SFMono-Regular, "SF Mono", Menlo,
  Consolas`. Body 14px/1.5. No webfonts: Primer ships on system faces.
- **Controls** — 6px radius, 1px `--border-default`, Primer's `--btn-shadow` in light
  (`0 1px 0 rgba(31,35,40,.1)`) and its dark equivalent (`0 0 0 1px #3d444d`).
- **Buttons** — green `--success-emphasis` for the one primary action per view;
  `.secondary` is `--canvas-subtle` plus a border; `.subtle` is borderless for tertiary.
- **Elevation** — the border carries the surface. Shadows are GitHub's small control
  shadows, not decorative glows. Panels are `.Box`: `--canvas-default` on
  `--border-default`.

## Theme

`initTheme()` runs before paint (an inline script in `<head>` sets `data-theme` to avoid a
flash). Order of preference: `?theme=` query (used by screenshots), then the visitor's saved
choice in `localStorage`, then `prefers-color-scheme`. The toggle flips light/dark and
persists the choice.

The **card** has its own independent theme (the Size and Card theme selects feed
`renderCard`); the page theme never overrides the artifact.

## Icons

Octicons, authored as inline SVG, one family, `fill: currentColor`. No emoji as icons — the
private-repo marker is GitHub's lock octicon, not an emoji. Icon sizes: 16px in nav and
buttons, 14px in the picker, 20px in the header logo.

## Layout

- Two columns at 769px and up: a 296px settings rail and a `minmax(0,1fr)` stage.
- Single column below 768px. Grid children carry `min-width: 0` so unbreakable content
  (the CLI `pre`) can never widen the column past the viewport.
- `.Box` is the only container. No nested cards.

## Motion

One authored moment: the card preview reveals on render — a 450ms blur-and-rise on an
exponential ease-out from an already-visible default, and only on a fresh generate (not on
resize repaint). The status dot pulses while a fetch is in flight. Everything is disabled
under `prefers-reduced-motion`.

## Browser surfaces

Themed from the palette, because these ship with the browser and belong to no design system:
text selection, scrollbars, `focus-visible` rings, `::placeholder`, and tabular numerals on
the stats row.

## Signature

The settings rail is the tool's whole promise: a repository, a range, a size, and one green
button. The card preview is the artifact. The CLI block is the escape hatch for local git and
unlimited ranges. Copy is GitHub's: controls name their action, errors name the problem and
the recovery.
