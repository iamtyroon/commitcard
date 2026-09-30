// HTML rendering. Row heights are fixed and subjects are single-line (ellipsis),
// so the card height is deterministic for a given commit count and never clips.
import { summarise, meter, dailySeries, isBulk } from './aggregate.mjs'

export const PRESETS = {
  twitter: { w: 1600, h: 900, pad: 56, scale: 2 },
  'twitter-square': { w: 1080, h: 1080, pad: 44, scale: 2 },
  'x-header': { w: 1500, h: 500, pad: 36, scale: 2 },
  og: { w: 1200, h: 630, pad: 32, scale: 2 },
  github: { w: 1100, h: null, pad: 22, scale: 2 },
}

export const THEMES = {
  dark: {
    bg: '#010409',
    panel: '#0d1117',
    border: '#30363d',
    hair: '#21262d',
    text: '#e6edf3',
    muted: '#7d8590',
    add: '#3fb950',
    del: '#f85149',
    accent: '#79c0ff',
    accentBg: 'rgba(31,111,235,.2)',
    accentBorder: '#316dca',
    empty: '#21262d',
    font: '-apple-system,Segoe UI,Inter,Roboto,Helvetica,Arial,sans-serif',
    mono: 'Consolas,"SF Mono",Menlo,monospace',
  },
  light: {
    bg: '#f6f8fa',
    panel: '#ffffff',
    border: '#d0d7de',
    hair: '#eaeef2',
    text: '#1f2328',
    muted: '#636c76',
    add: '#1a7f37',
    del: '#cf222e',
    accent: '#0969da',
    accentBg: 'rgba(9,105,218,.1)',
    accentBorder: '#54aeff',
    empty: '#eaeef2',
    font: '-apple-system,Segoe UI,Inter,Roboto,Helvetica,Arial,sans-serif',
    mono: 'Consolas,"SF Mono",Menlo,monospace',
  },
  midnight: {
    bg: '#05070f',
    panel: '#0c1120',
    border: '#1e293b',
    hair: '#172033',
    text: '#e2e8f0',
    muted: '#64748b',
    add: '#34d399',
    del: '#f87171',
    accent: '#7dd3fc',
    accentBg: 'rgba(56,189,248,.16)',
    accentBorder: '#0ea5e9',
    empty: '#1e293b',
    font: '-apple-system,Segoe UI,Inter,Roboto,Helvetica,Arial,sans-serif',
    mono: 'Consolas,"SF Mono",Menlo,monospace',
  },
}

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m],
  )

const num = (v) => (Number.isFinite(v) && v !== 0 ? Math.round(v).toLocaleString('en-US') : '0')

const bars = (fill) =>
  fill
    .map(
      (kind) =>
        `<i class="blk ${kind}"${
          kind === 'add' ? ' style="background:var(--add)"' : ''
        }></i>`,
    )
    .join('')

const fmtTime = (ms, tz) =>
  new Date(ms + tz * 3600e3).toISOString().slice(11, 16)

export function renderCard(opts) {
  const {
    commits,
    repoName = 'repo',
    branch = 'main',
    title,
    subtitle,
    label,
    tz = 0,
    avatar = null,
    handle = null,
    footerNote = null,
    theme = 'dark',
    preset = 'github',
    maxRows = 8,
    showBulkTag = true,
    truncated = false,
  } = opts
  const t = THEMES[theme] ?? THEMES.dark
  const p = PRESETS[preset] ?? PRESETS.github
  const fixed = Boolean(p.h)
  const sum = summarise(commits)
  const blocks = meter()(sum.all.additions, sum.all.deletions)
  const focusBlocks = meter()(sum.focus.additions, sum.focus.deletions)
  const shown = commits.slice(0, maxRows)
  const hidden = commits.length - shown.length
  const multiDay = new Set(commits.map((c) => new Date(c.committedAt + tz * 3600e3).toISOString().slice(0, 10))).size > 1
  const series = multiDay ? dailySeries(commits, tz) : null
  const maxDay = series ? Math.max(...series.map((d) => d.additions + d.deletions), 1) : 1

  // For fixed-height presets, grow the row height so a short list still fills the
  // frame. Clamped so it never looks stretched or cramped.
  let rowH = 38
  if (fixed) {
    const rowCount = shown.length + (hidden > 0 ? 1 : 0)
    const chrome =
      2 * p.pad +
      68 + // head
      38 + // panel padding
      30 * (sum.bulkCommits.length ? 2 : 1) +
      (sum.bulkCommits.length ? 16 : 0) +
      16 + // table margin
      20 + // thead
      30 // foot
    const avail = p.h - chrome
    if (rowCount > 0) rowH = Math.max(38, Math.min(58, Math.floor(avail / rowCount)))
  }

  const statRow = (s, blocksFilled, caption) => `
    <div class="statrow${caption ? ' sub' : ''}">
      <div class="l">${caption ? `<span class="cap">${esc(caption)}</span>` : ''}<span class="files">${num(s.files)} files changed</span></div>
      <div class="nums">
        <span class="add">+${num(s.additions)}</span>
        <span class="del">${s.deletions ? `-${num(s.deletions)}` : '0'}</span>
        <span class="blocks">${bars(blocksFilled)}</span>
      </div>
    </div>`

  const row = (c) => `
    <tr>
      <td class="t">${fmtTime(c.committedAt, tz)}</td>
      <td class="sha">${esc(c.shortSha)}</td>
      <td class="msg">${esc(c.subject)}${
        showBulkTag && isBulk(c) ? '<span class="tag">bulk</span>' : ''
      }</td>
      <td class="n">${num(c.files)}</td>
    <td class="n add">${c.additions ? `+${num(c.additions)}` : '0'}</td>
      <td class="n del">${c.deletions ? `-${num(c.deletions)}` : '0'}</td>
    </tr>`

  const histo = series
    ? `<div class="histo">${series
        .map(
          (d) => `<div class="hcol" title="${d.day}: ${num(d.additions + d.deletions)} lines">
            <div class="hbar" style="height:${Math.max(6, Math.round(((d.additions + d.deletions) / maxDay) * 64))}px"></div>
            <span class="hday">${d.day.slice(5)}</span>
          </div>`,
        )
        .join('')}</div>`
    : ''

  const avatarHtml = avatar
    ? `<img class="av" src="${esc(avatar)}" alt="">`
    : `<span class="av ph">${esc((repoName[0] ?? '#').toUpperCase())}</span>`
  const handleHtml = handle ? `<span class="handle">${esc(handle)}</span>` : ''
  const headTitle = esc(title ?? repoName)
  const headSub = esc(subtitle ?? '')
  const truncNote = truncated
    ? ` Showing the first ${sum.all.commits} commits (raise --max-commits for more).`
    : ''
  const foot = esc(
    footerNote ??
      (sum.bulkCommits.length
        ? `Totals across ${sum.all.commits} commits${label ? ` · ${label}` : ''}.${truncNote} Second row excludes ${sum.bulkCommits.length} bulk cleanup commit(s) (tagged "bulk") so source churn stays readable.`
        : `Totals across ${sum.all.commits} commits${label ? ` · ${label}` : ''}.${truncNote}`),
  )

  return `<!doctype html>
<meta charset="utf-8">
<style>
  :root{
    --bg:${t.bg};--panel:${t.panel};--border:${t.border};--hair:${t.hair};--text:${t.text};
    --muted:${t.muted};--add:${t.add};--del:${t.del};--accent:${t.accent};
    --accentBg:${t.accentBg};--accentBorder:${t.accentBorder};--empty:${t.empty};
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${p.w}px;height:${p.h ?? 'auto'}px;background:var(--bg);
    font:400 15px/1.5 ${t.font};color:var(--text);
    display:flex;align-items:${fixed ? 'stretch' : 'center'};justify-content:center;padding:${p.pad}px}
  .wrap{width:100%;max-width:${p.w - p.pad * 2}px;display:flex;flex-direction:column;${fixed ? 'height:100%' : ''}}
  .head{display:flex;align-items:center;gap:14px;padding:16px 22px;background:var(--panel);
    border:1px solid var(--border);border-bottom:0;border-radius:14px 14px 0 0}
  .av{width:34px;height:34px;border-radius:50%;flex:0 0 auto;object-fit:cover;
    background:var(--accentBg);border:1px solid var(--accentBorder)}
  .av.ph{display:grid;place-items:center;font:700 15px ${t.mono};color:var(--accent)}
  .htitle{font-weight:600;font-size:16px;line-height:1.25}
  .hsub{color:var(--muted);font-size:12.5px;line-height:1.35}
  .pill{background:var(--accentBg);border:1px solid var(--accentBorder);color:var(--accent);
    border-radius:2em;padding:3px 13px;font:600 13px ${t.mono}}
  .spacer{flex:1}
  .handle{color:var(--muted);font-size:13px}
  .panel{background:var(--panel);border:1px solid var(--border);border-radius:0 0 14px 14px;
    padding:20px 22px 18px;${fixed ? 'flex:1;display:flex;flex-direction:column' : ''}}
  .statrow{display:flex;align-items:center;justify-content:space-between;height:30px}
  .statrow.sub{border-top:1px dashed var(--hair);margin-top:6px;padding-top:10px;height:auto}
  .statrow .files{font-weight:600;font-size:16px}
  .statrow.sub .files{color:var(--muted);font-weight:400;font-size:14px}
  .cap{display:inline-block;color:var(--muted);font:600 11px ${t.font};
    text-transform:uppercase;letter-spacing:.07em;margin-right:12px}
  .nums{display:flex;align-items:center;gap:10px;font:600 17px ${t.mono}}
  .blocks{display:inline-flex;gap:4px;margin-left:4px}
  .blk{width:10px;height:10px;border-radius:3px;display:inline-block}
  .blk.del{background:var(--del)}
  table{width:100%;border-collapse:collapse;margin-top:16px;table-layout:fixed}
  th{text-align:left;color:var(--muted);font:600 11px ${t.font};text-transform:uppercase;
    letter-spacing:.07em;padding:0 10px 9px;border-bottom:1px solid var(--border)}
  td{padding:9px 10px;border-bottom:1px solid var(--hair);height:${rowH}px;vertical-align:middle}
  th.r,td.n{text-align:right;width:86px}
  .t{color:var(--muted);font:12.5px ${t.mono};width:52px}
  .sha{color:var(--accent);font:12.5px ${t.mono};width:78px}
  .msg{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tag{margin-left:8px;background:var(--accentBg);border:1px solid var(--accentBorder);
    color:var(--accent);border-radius:2em;padding:1px 8px;font:600 10px ${t.font};
    text-transform:uppercase;letter-spacing:.05em;vertical-align:1px}
  .histo{display:flex;align-items:flex-end;gap:6px;height:78px;margin-top:16px;
    padding:0 4px;border-bottom:1px solid var(--border)}
  .hcol{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;flex:1}
  .hbar{width:100%;max-width:38px;background:var(--accent);border-radius:3px 3px 0 0;opacity:.85}
  .hday{color:var(--muted);font:11px ${t.mono}}
  .foot{margin-top:${fixed ? 'auto' : '14px'};padding-top:14px;color:var(--muted);font-size:11.5px;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
</style>
<div class="wrap">
  <div class="head">
    ${avatarHtml}
    <div>
      <div class="htitle">${headTitle}</div>
      ${headSub ? `<div class="hsub">${headSub}</div>` : ''}
    </div>
    <span class="spacer"></span>
    <span class="pill">${esc(branch)}</span>
    ${handleHtml}
  </div>
  <div class="panel">
    ${statRow(sum.all, blocks)}
    ${sum.bulkCommits.length ? statRow(sum.focus, focusBlocks, 'source only') : ''}
    ${histo}
    <table>
      <thead><tr><th>Time</th><th>Commit</th><th>Subject</th>
        <th class="r">Files</th><th class="r">Added</th><th class="r">Removed</th></tr></thead>
      <tbody>${shown.map(row).join('')}${
        hidden > 0
          ? `<tr><td></td><td colspan="5" class="more">+${num(hidden)} more commit${hidden > 1 ? 's' : ''}</td></tr>`
          : ''
      }</tbody>
    </table>
    <div class="foot">${foot}</div>
  </div>
</div>`
}
