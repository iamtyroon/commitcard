import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderCard } from '../src/render.mjs'

const commit = (o) => ({
  sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'feat: thing', author: 'a',
  committedAt: Date.parse('2026-09-30T10:00:00Z'), files: 3, additions: 40,
  deletions: 12, paths: ['a.ts'], ...o,
})
const card = (opts = {}) =>
  renderCard({
    commits: [commit({})], repoName: 'commitcard', branch: 'main', label: '7 days', tz: 3,
    avatar: 'https://avatars.githubusercontent.com/u/105237183?v=4',
    handle: '@iamtyroon', theme: 'dark', preset: 'twitter', maxRows: 8, ...opts,
  })

// Exporting builds an SVG data URI, which the browser parses as strict XML. One
// unclosed void element invalidates the whole document, the SVG never loads, and
// both Download PNG and Copy PNG fail with no obvious cause. These pin the fix.
const VOID = /<(img|br|hr|source|wbr)\b([^>]*?)\/?>/g
const repair = (s) => s.replace(VOID, '<$1$2/>')
const unclosed = (s) => (s.match(/<(img|br|hr|source|wbr)\b[^>]*?(?<!\/)>/g) || [])

test('void elements survive XML serialisation', () => {
  // What a browser hands back from outerHTML, whatever the source said.
  const serialised = '<img class="av" src="https://example.test/a.png" alt="">'
  assert.equal(unclosed(serialised).length, 1, 'precondition: raw serialisation is invalid XML')
  assert.equal(unclosed(repair(serialised)).length, 0, 'repair must close it')
})

test('the repair is idempotent and preserves attributes', () => {
  const once = repair('<img src="a" alt="b">')
  assert.equal(repair(once), once)
  assert.equal(once, '<img src="a" alt="b"/>')
  assert.equal(repair('<br>'), '<br/>')
  assert.equal(repair('<hr/>'), '<hr/>')
  assert.equal(repair('<div class="x"><img src="q"></div>'), '<div class="x"><img src="q"/></div>')
})

test('the rendered card really contains an img, so the repair is load-bearing', () => {
  assert.match(card(), /<img class="av"/)
})

test('a card without an avatar needs no repair', () => {
  const html = card({ avatar: null })
  assert.equal(unclosed(html).length, 0)
  assert.match(html, /class="av ph"/)
})
