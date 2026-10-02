// Pure aggregation: classify commits, compute totals, build a time series.

// A "bulk" commit is a large mechanical change (untracking build output, deleting
// generated docs) that swamps the diff numbers. Detect by shape, not by message alone.
const BULK_MSG = /\b(chore|remove|untrack|revert|cleanup|clean up|drop|deprecate)\b/i
export function isBulk(c) {
  const churn = c.additions + c.deletions
  if (churn === 0) return false
  return c.deletions > 500 && c.additions / c.deletions < 0.1 && BULK_MSG.test(c.subject)
}

// Automation commits (Actions, Dependabot, CI accounts) land in a range and are
// reachable, but they are not the account holder's work. Callers default them out.
export function isBot(c) {
  return /\[bot\]$/i.test(c.authorLogin ?? '') || /\bbot\b/i.test(c.author ?? '')
}

export function totals(commits) {
  return {
    commits: commits.length,
    files: commits.reduce((a, c) => a + c.files, 0),
    additions: commits.reduce((a, c) => a + c.additions, 0),
    deletions: commits.reduce((a, c) => a + c.deletions, 0),
    uniqueFiles: new Set(commits.flatMap((c) => c.paths ?? [])).size,
  }
}

export function summarise(commits) {
  const bulk = commits.filter(isBulk)
  const bulkShas = new Set(bulk.map((c) => c.shortSha))
  const focus = commits.filter((c) => !bulkShas.has(c.shortSha))
  return {
    all: { ...totals(commits), bulkCommits: bulk.length },
    focus: { ...totals(focus), bulkCommits: 0 },
    focusCommits: focus,
    bulkCommits: bulk,
  }
}

// GitHub's 5-block meter: fraction of the meter filled green for additions.
export function meter(count = 5) {
  return (additions, deletions) => {
    const t = additions + deletions
    const green = t ? Math.round((additions / t) * count) : 0
    return Array.from({ length: count }, (_, i) => (i < green ? 'add' : 'del'))
  }
}

// Per-day histogram for multi-day ranges.
export function dailySeries(commits, tzOffsetHours = 0) {
  const byDay = new Map()
  for (const c of commits) {
    const key = new Date(c.committedAt + tzOffsetHours * 3600e3).toISOString().slice(0, 10)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(c)
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, cs]) => ({ day, ...totals(cs) }))
}
