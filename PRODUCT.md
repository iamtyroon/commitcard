# commitcard — product truth

## What it is

commitcard turns a day or range of git commits into a clean, shareable image for Twitter/X,
LinkedIn, and blog posts. It has two frontends over one card renderer:

- **CLI** (`bin/commitcard.mjs`) — reads a GitHub repo (via `gh` CLI or the public API) or a local
  git checkout (`--cwd .`) and writes a PNG. No caps for local git; paginates GitHub history.
- **Web app** (`index.html`, GitHub Pages) — a client-side generator for public repos, with
  optional GitHub sign-in (personal token or device flow) that unlocks private repos, a
  repository picker, and a 200-commit / 5,000-req-per-hour budget.

## Who it is for

Developers who want a clean, on-brand commit-stats image to post after shipping, in a single
command or a single page load, without hand-assembling a graphic.

## What it must do

- Read commits and compute additions / deletions / files exactly the way GitHub does.
- Separate real source work from bulk mechanical commits (untracked build output, deleted
  generated files) so the headline number is not misleading.
- Render a card at social sizes (Twitter 1600×900 and friends) with the repo owner's identity.
- Work offline for local repos, and never upload or persist a token.

## Brand commitments

- The visual world is **GitHub / Primer**: Primer design tokens, GitHub's system font stack,
  6px control radius, bordered buttons, Primer light and dark themes with a first-class toggle.
  This is pinned by the user and is not to be re-derived.
- The CLI is the full-power path; the browser is the zero-setup path. Both are first-class.
- Everything renders client-side in the browser; nothing is uploaded.

## Boundaries

- Never embed a GitHub client secret. The optional OAuth client_id is public by design.
- Tokens live in memory + sessionStorage only, and go only to api.github.com.
- Claims are computed from real API data; nothing is invented for effect.
