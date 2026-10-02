import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBulk, isBot, totals, summarise, meter, dailySeries } from '../src/aggregate.mjs'

const c = (o) => ({
  sha: 'x'.repeat(40),
  shortSha: 'xxxxxxx',
  subject: 'feat: thing',
  author: 'a',
  committedAt: Date.parse('2026-09-29T10:00:00Z'),
  files: 1,
  additions: 1,
  deletions: 0,
  paths: ['a.ts'],
  ...o,
})

test('isBulk flags big mechanical deletions, not real work', () => {
  assert.equal(isBulk(c({ deletions: 58430, additions: 1, subject: 'chore: untrack compiled test output' })), true)
  assert.equal(isBulk(c({ deletions: 32832, additions: 0, subject: 'chore: remove obsolete files' })), true)
  // big but meaningful (balanced) change is not bulk
  assert.equal(isBulk(c({ deletions: 900, additions: 800, subject: 'chore: remove x' })), false)
  // big deletion but message says feat — not our heuristic
  assert.equal(isBulk(c({ deletions: 900, additions: 0, subject: 'feat: rewrite engine' })), false)
  // small chore stays focus
  assert.equal(isBulk(c({ deletions: 3, additions: 1, subject: 'chore: bump dep' })), false)
})

test('totals sums files, adds, dels and unique paths', () => {
  const t = totals([c({ files: 2, additions: 3, deletions: 1, paths: ['a', 'b'] }), c({ files: 1, additions: 5, deletions: 0, paths: ['b', 'c'] })])
  assert.equal(t.commits, 2)
  assert.equal(t.files, 3)
  assert.equal(t.additions, 8)
  assert.equal(t.deletions, 1)
  assert.equal(t.uniqueFiles, 3)
})

test('isBot catches automation accounts without flagging humans', () => {
  assert.equal(isBot({ authorLogin: 'github-actions[bot]', author: 'github-actions[bot]' }), true)
  assert.equal(isBot({ authorLogin: 'dependabot[bot]', author: 'dependabot[bot]' }), true)
  assert.equal(isBot({ authorLogin: null, author: 'renovate bot' }), true)
  // A human whose name merely contains "bot" as a word elsewhere is not filtered.
  assert.equal(isBot({ authorLogin: 'iamtyroon', author: 'Tesfaalem Nahom' }), false)
  // Missing identity must not throw or silently drop the commit.
  assert.equal(isBot({ authorLogin: null, author: 'Codex' }), false)
})

test('summarise splits bulk from source-only focus totals', () => {
  const s = summarise([
    c({ shortSha: 'aaaaaaa', additions: 100, deletions: 10, subject: 'feat: real' }),
    c({ shortSha: 'bbbbbbb', additions: 1, deletions: 5000, subject: 'chore: untrack output' }),
  ])
  assert.equal(s.all.commits, 2)
  assert.equal(s.focus.commits, 1)
  assert.equal(s.focus.additions, 100)
  assert.equal(s.focus.deletions, 10)
  assert.equal(s.bulkCommits.length, 1)
})

test('meter fills proportionally to additions', () => {
  assert.deepEqual(meter()(5, 0), ['add', 'add', 'add', 'add', 'add'])
  assert.deepEqual(meter()(0, 5), ['del', 'del', 'del', 'del', 'del'])
  assert.deepEqual(meter()(0, 0), ['del', 'del', 'del', 'del', 'del'])
  const half = meter()(5, 5)
  assert.equal(half.filter((x) => x === 'add').length, 3) // Math.round(2.5) => 3
})

test('dailySeries buckets by day honouring tz offset', () => {
  const s = dailySeries(
    [
      c({ committedAt: Date.parse('2026-09-28T23:00:00Z'), additions: 1, deletions: 0 }), // Nairobi 29th 02:00
      c({ committedAt: Date.parse('2026-09-29T02:00:00Z'), additions: 2, deletions: 0 }), // Nairobi 29th 05:00
      c({ committedAt: Date.parse('2026-09-29T23:00:00Z'), additions: 3, deletions: 0 }), // Nairobi 30th 02:00
    ],
    3,
  )
  assert.equal(s.length, 2)
  assert.equal(s[0].day, '2026-09-29')
  assert.equal(s[0].additions, 3)
  assert.equal(s[1].day, '2026-09-30')
  assert.equal(s[1].additions, 3)
})
