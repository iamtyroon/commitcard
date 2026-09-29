#!/usr/bin/env node
import { join, resolve, basename } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { renderCard, PRESETS, THEMES } from '../src/render.mjs'
import { collectFromGitHub, collectFromLocalGit, which } from '../src/fetch.mjs'
import { screenshot } from '../src/chrome.mjs'
import { summarise, dailySeries } from '../src/aggregate.mjs'

const pexec = promisify(exec)
const HOUR = 3600e3
const DAY = 24 * HOUR

function parseArgs(argv) {
  const out = {
    _: [],
    preset: 'twitter',
    theme: 'dark',
    maxRows: 8,
    tz: null,
    scale: 2,
  }
  const flags = {
    repo: 'repo',
    branch: 'branch',
    range: 'range',
    from: 'from',
    to: 'to',
    date: 'date',
    preset: 'preset',
    theme: 'theme',
    title: 'title',
    subtitle: 'subtitle',
    label: 'label',
    handle: 'handle',
    avatar: 'avatar',
    note: 'note',
    out: 'out',
    api: 'api',
    cwd: 'cwd',
    tz: 'tz',
    'max-rows': 'maxRows',
    scale: 'scale',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const [kRaw, inline] = a.slice(2).split('=')
    const k = flags[kRaw]
    if (!k) continue
    let v = inline
    if (v === undefined) {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        v = next
        i++
      } else v = 'true'
    }
    if (k === 'maxRows' || k === 'tz' || k === 'scale') v = Number(v)
    out[k] = v
  }
  for (const b of ['open', 'json', 'help', 'no-bulk-tag', 'list-themes'])
    out[b] = argv.includes(`--${b}`)
  return out
}

const HELP = `commitcard — a shareable GitHub-style commit-stats card

Usage:
  commitcard --repo owner/name [range] [options]
  commitcard --cwd . [options]            # read local git history (no network)

Ranges (default: today, in --tz timezone):
  today | yesterday | week | 7d | 30d | month | all
  --from 2026-09-01 --to 2026-09-29
  --date 2026-09-29

Source:
  --repo owner/name   GitHub repo (uses gh CLI if installed, else public API)
  --branch <name>     branch to read (default: repo default branch)
  --cwd <dir>         read local git history instead of GitHub
  --api gh|http       force the API backend

Card:
  --preset twitter|twitter-square|x-header|og|github   (default: twitter)
  --theme dark|light|midnight                          (default: dark)
  --title <text>          override the headline
  --subtitle <text>       small line under the title
  --label <text>          shown in the footer (e.g. "Week of Sep 22")
  --handle <text>         e.g. @yourhandle, shown top-right
  --avatar <url|path>     avatar image or a direct image URL
  --note <text>           replace the default footer note
  --max-rows <n>          commits listed (default 8)
  --tz <hours>            timezone offset for "today" & times (e.g. 3)
  --no-bulk-tag           hide the "bulk" badge

Output:
  --out <path>     output PNG path (default ./commitcard-<date>.png)
  --scale <n>      device scale (default 2)
  --json           print stats as JSON to stdout (no image)
  --open           open the PNG after rendering

Examples:
  commitcard --repo iamtyroon/Procureline today --tz 3 --handle @iamtyroon
  commitcard --repo vercel/next.js week --preset twitter --theme light
  commitcard --cwd . week --tz 3 --title "My week in code"
`

// Resolve [from,to] epoch ms for a range token in a given tz offset.
function resolveRange(opts) {
  const tz = opts.tz ?? 0
  const now = Date.now()
  const midnight = (d) => {
    const shifted = new Date(d.getTime() + tz * HOUR)
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - tz * HOUR
  }
  const todayStart = midnight(new Date(now))
  const day = (n) => todayStart - n * DAY
  const isoDate = (ms) => new Date(ms + tz * HOUR).toISOString().slice(0, 10)
  const fromDateStr = opts.from || opts.date
  const toDateStr = opts.to || opts.date
  if (fromDateStr && toDateStr)
    return { from: Date.parse(`${fromDateStr}T00:00:00Z`) - tz * HOUR, to: Date.parse(`${toDateStr}T23:59:59Z`) - tz * HOUR, label: `${fromDateStr} → ${toDateStr}` }
  if (fromDateStr)
    return { from: Date.parse(`${fromDateStr}T00:00:00Z`) - tz * HOUR, to: now, label: fromDateStr }
  if (opts.date) {
    const d = opts.date
    return { from: Date.parse(`${d}T00:00:00Z`) - tz * HOUR, to: Date.parse(`${d}T23:59:59Z`) - tz * HOUR, label: d }
  }
  const token = opts.range ?? opts._[0] ?? 'today'
  switch (token) {
    case 'yesterday': {
      const y = isoDate(day(1))
      return { from: day(1), to: day(0) - 1, label: y }
    }
    case 'week':
    case '7d': {
      const f = day(6)
      return { from: f, to: now, label: `7 days to ${isoDate(todayStart)}` }
    }
    case '30d':
      return { from: day(29), to: now, label: `30 days to ${isoDate(todayStart)}` }
    case 'month': {
      const s = new Date(now)
      const first = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1) - tz * HOUR
      return { from: first, to: now, label: new Date(first + tz * HOUR).toISOString().slice(0, 7) }
    }
    case 'all':
      return { from: 0, to: now, label: 'all time' }
    case 'today':
    default: {
      return { from: todayStart, to: now, label: isoDate(todayStart) }
    }
  }
}

// Deterministic fit height for the auto-sized 'github' preset, so nothing is clipped.
function autoHeight({ rows, focusRow, histo, preset }) {
  if (preset !== 'github') return PRESETS[preset].h
  const bodyPad = 22 * 2
  const head = 68
  const panelPad = 38
  const statRow = 30
  const focusExtra = 16
  const histoH = histo ? 16 + 78 : 0
  const table = 16 + 20 + rows * 38
  const foot = 14 + 16
  return bodyPad + head + panelPad + statRow * (focusRow ? 2 : 1) + (focusRow ? focusExtra : 0) + histoH + table + foot
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || (!opts.repo && !opts.cwd)) {
    console.log(HELP)
    return
  }
  if (opts['list-themes']) {
    console.log('themes:', Object.keys(THEMES).join(', '))
    console.log('presets:', Object.keys(PRESETS).join(', '))
    return
  }
  if (!opts.repo && !opts.cwd) {
    console.error('error: pass --repo owner/name or --cwd <dir>')
    process.exit(1)
  }

  const tz = opts.tz ?? 0
  const { from, to, label } = resolveRange(opts)
  const useLocal = Boolean(opts.cwd) && !opts.repo

  let data
  if (useLocal) {
    data = await collectFromLocalGit({ cwd: resolve(opts.cwd), from, to })
  } else {
    data = await collectFromGitHub({
      repo: opts.repo,
      ref: opts.branch ?? '',
      from,
      to,
      api: opts.api ?? '',
      onProgress: (d, t) => process.stderr.write(`\rfetched ${d}/${t} commits`),
    })
    process.stderr.write('\n')
  }
  data.commits.sort((a, b) => b.committedAt - a.committedAt)

  const sum = summarise(data.commits)
  const series = dailySeries(data.commits, tz)
  const meta = {
    repo: data.repo,
    branch: data.branch,
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), label },
    totals: sum.all,
    focusTotals: sum.focus,
    daily: series,
  }
  if (opts.json) {
    console.log(JSON.stringify(meta, null, 2))
    return
  }

  const multiDay = series.length > 1
  const preset = PRESETS[opts.preset] ? opts.preset : 'twitter'
  const explicitAvatar = opts.avatar && opts.avatar !== 'true' ? opts.avatar : null
  const avatar = explicitAvatar ?? data.ownerAvatar ?? null
  const explicitHandle = opts.handle && opts.handle !== 'true' ? opts.handle : null
  const handle = explicitHandle ?? (data.ownerLogin ? `@${data.ownerLogin}` : null)
  const html = renderCard({
    commits: data.commits,
    repoName: typeof data.repo === 'string' ? basename(data.repo) : data.repo,
    branch: data.branch,
    title: opts.title ?? undefined,
    subtitle: opts.subtitle ?? undefined,
    label,
    tz,
    avatar,
    handle,
    footerNote: opts.note ?? null,
    theme: opts.theme,
    preset,
    maxRows: opts.maxRows,
    showBulkTag: !opts['no-bulk-tag'],
  })

  const dstr = label.replace(/[^\w-]/g, '') || 'range'
  const outPath = resolve(
    !opts.out || opts.out === 'true' ? join(process.cwd(), `commitcard-${dstr}.png`) : opts.out,
  )
  const shownRows = Math.min(data.commits.length, opts.maxRows) + (data.commits.length > opts.maxRows ? 1 : 0)
  const height = autoHeight({ rows: shownRows, focusRow: sum.bulkCommits.length > 0, histo: multiDay, preset })
  await screenshot({ html, out: outPath, width: PRESETS[preset].w, height, scale: opts.scale })

  console.log(`✓ ${outPath}`)
  console.log(
    `  ${sum.all.commits} commits · ${sum.all.files} files · +${sum.all.additions} / -${sum.all.deletions}`,
  )
  if (opts.open) await pexec('cmd', process.platform === 'win32' ? ['/c', 'start', '', outPath] : ['open', outPath])
}

main().catch((e) => {
  console.error('commitcard:', e.message)
  process.exit(1)
})
