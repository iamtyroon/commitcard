# commitcard

Turn a day (or week) of commits into a clean, shareable image for Twitter/X, LinkedIn, or a blog post.

`commitcard` reads your commit history, computes the stats the way GitHub does, and renders a
GitHub-style card sized for social. It handles the noise: large "bulk" commits (untracking build
output, deleting generated files) are detected and shown separately so your real work isn't drowned out.

![example](docs/example.png)

## Quick start

```bash
# today's commits for a GitHub repo (uses gh if logged in, else the public API)
npx commitcard --repo iamtyroon/Procureline today

# this week, with your handle and a title
npx commitcard --repo vercel/next.js week --handle @you --title "My week in code"
```

No install needed to try it — `npx commitcard ...` runs it directly. To install globally:

```bash
npm install -g commitcard
commitcard --repo owner/name today
```

## Where the data comes from

- **GitHub** (`--repo owner/name`) — the default. Uses the `gh` CLI when available (so **private repos work**),
  otherwise the public GitHub API (set `GITHUB_TOKEN` to raise the rate limit).
- **Local git** (`--cwd .`) — reads the git history in a directory. No network, works offline, works on
  any repo (even non-GitHub).

## Ranges

The range token is the first positional argument (or `--range`):

| Token | Meaning |
|---|---|
| `today` (default) | today, in your `--tz` timezone |
| `yesterday` | yesterday |
| `week` / `7d` | last 7 days (also draws a per-day histogram) |
| `30d` | last 30 days |
| `month` | current calendar month |
| `all` | entire history |

Or pin exact dates: `--from 2026-09-01 --to 2026-09-29`, or a single day with `--date 2026-09-29`.

## Presets (image size)

| Preset | Size | Best for |
|---|---|---|
| `twitter` (default) | 1600×900 | Twitter/X timeline, LinkedIn |
| `twitter-square` | 1080×1080 | Instagram, square posts |
| `x-header` | 1500×500 | X profile header |
| `og` | 1200×630 | Open Graph / blog previews |
| `github` | auto | README / issue comments (sized to content) |

## Themes

`dark` (default), `light`, `midnight`.

## Common examples

```bash
# square post, light theme, your avatar and handle
commitcard --repo owner/name today --preset twitter-square --theme light \
  --handle @you --avatar https://github.com/you.png

# week-in-review with the per-day histogram
commitcard --repo owner/name week --tz 3 --title "Week in review" --label "Sep 22 – 29"

# from a local checkout, no network
commitcard --cwd . week --tz 3

# just the numbers, as JSON (no image)
commitcard --repo owner/name today --json
```

## Options

```
--repo owner/name   GitHub repo to read
--branch <name>     branch (default: repo default branch)
--cwd <dir>         read local git history instead
--api gh|http       force the API backend
--tz <hours>        timezone offset for "today" and times (e.g. 3 for Nairobi)

--preset twitter|twitter-square|x-header|og|github
--theme dark|light|midnight
--title <text>      headline (defaults to repo name)
--subtitle <text>   small line under the title
--label <text>      footer label (e.g. "Week of Sep 22")
--handle <text>     top-right handle (defaults to @owner)
--avatar <url>      avatar image (defaults to the repo owner's)
--note <text>       replace the default footer note
--max-rows <n>      commits listed (default 8)
--max-commits <n>   cap on commits analysed (default 1000); card says if it hits the cap
--no-bulk-tag       hide the "bulk" badge

--out <path>        output PNG (default ./commitcard-<date>.png)
--scale <n>         device scale (default 2)
--json              print stats as JSON, no image
--open              open the PNG when done
```

## How "bulk" detection works

A commit is treated as **bulk** when it removes a lot and adds almost nothing *and* reads like
maintenance (`chore`, `remove`, `untrack`, `revert`, ...). Bulk commits get a `bulk` badge and are
excluded from the "source only" totals, so the headline shows both the raw diff and the signal.

## Requirements

- Node.js 18+
- A Chromium/Chrome/Edge binary for rendering. `commitcard` finds a normal install automatically
  (including Playwright's cached Chromium). Override with `COMMITCARD_BROWSER=/path/to/chrome`.
- For private GitHub repos: `gh auth login`, or `GITHUB_TOKEN`.

## Development

```bash
npm test          # unit tests for the aggregation logic
node bin/commitcard.mjs --repo owner/name today --tz 3   # local run
```

## License

MIT
