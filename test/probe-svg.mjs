// Probe: find what in the rendered card breaks SVG-as-image parsing.
import { renderCard } from '../src/render.mjs'

const c = (o) => ({
  sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'feat: thing', author: 'a',
  committedAt: Date.parse('2026-09-30T10:00:00Z'), files: 3, additions: 40,
  deletions: 12, paths: ['a.ts'], ...o,
})
const html = renderCard({
  commits: [c({})], repoName: 'commitcard', branch: 'main', label: '7 days', tz: 3,
  avatar: 'https://avatars.githubusercontent.com/u/105237183?v=4',
  handle: '@iamtyroon', theme: 'dark', preset: 'twitter', maxRows: 8,
})

const style = html.match(/<style>([\s\S]*?)<\/style>/)[1]
const wrapish = html.slice(html.indexOf('<div class="wrap">'))

// & is legal in XML only as an entity reference.
const ampRe = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g
console.log('unescaped & in wrap :', (wrapish.match(ampRe) || []).length)
console.log('unescaped & in style:', (style.match(ampRe) || []).length)

let m
const shown = []
while ((m = ampRe.exec(wrapish)) && shown.length < 6) {
  shown.push(wrapish.slice(Math.max(0, m.index - 50), m.index + 50))
}
for (const s of shown) console.log('  ...', JSON.stringify(s))

// Void elements must be self-closed or strict XML rejects the whole document.
const voids = wrapish.match(/<(img|br|hr|meta|link|input|source|wbr|col)\b[^>]*>/g) || []
const bad = voids.filter((v) => !/\/>$/.test(v))
console.log('void tags total:', voids.length)
console.log('void tags NOT self-closed:', bad.length)
for (const v of bad.slice(0, 4)) console.log('  ', v.slice(0, 90))
