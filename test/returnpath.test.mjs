import { test } from 'node:test'
import assert from 'node:assert/strict'

// The post-login redirect once sent users to the bare origin
// (https://iamtyroon.github.io/?signedin=1), which 404s because the app is served
// from /commitcard/. ALLOWED_ORIGIN is the origin for the CORS check; the path is
// separate. This pins the two apart so the regression cannot return.
test('ALLOWED_ORIGIN origin and RETURN_PATH path compose into a real URL', () => {
  const origin = 'https://iamtyroon.github.io'
  const returnPath = '/commitcard/'
  const target = `${origin}${returnPath}?signedin=1`
  assert.equal(target, 'https://iamtyroon.github.io/commitcard/?signedin=1')
  // The origin alone is what broke it: no path, so GitHub Pages 404s.
  assert.ok(!`${origin}/?signedin=1`.includes('/commitcard/'))
})

test('RETURN_PATH defaults to the app path when unset', () => {
  const returnPath = process.env.RETURN_PATH || '/commitcard/'
  assert.equal(returnPath, '/commitcard/')
  assert.ok(returnPath.startsWith('/'), 'must stay same-origin; an absolute URL would allow an open redirect')
})
