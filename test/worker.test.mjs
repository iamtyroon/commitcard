import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCookies, cookie, safeGhPath, TOKEN_COOKIE } from '../api/oauth.js'

test('safeGhPath allows only the read prefixes the card uses', () => {
  assert.equal(safeGhPath('user'), 'user')
  assert.equal(safeGhPath('user/repos?per_page=100'), 'user/repos?per_page=100')
  assert.equal(safeGhPath('repos/iamtyroon/commitcard'), 'repos/iamtyroon/commitcard')
  assert.equal(safeGhPath('search/commits?q=x'), 'search/commits?q=x')
})

test('safeGhPath blocks traversal, absolute and off-host targets', () => {
  // These are the cases that would turn the worker into an open proxy.
  assert.equal(safeGhPath('https://evil.example/steal'), null)
  assert.equal(safeGhPath('../../other-host'), null)
  assert.equal(safeGhPath('/user'), null)
  assert.equal(safeGhPath('user/../admin'), null)
  assert.equal(safeGhPath(''), null)
  assert.equal(safeGhPath(undefined), null)
  // Non-allowlisted prefixes stay blocked even without traversal.
  assert.equal(safeGhPath('authorizations'), null)
  assert.equal(safeGhPath('gists'), null)
})

test('cookie is httpOnly, Secure and SameSite=None for cross-site use', () => {
  const c = cookie(TOKEN_COOKIE, 'abc123', 60)
  assert.match(c, /^cc_token=abc123/)
  // HttpOnly keeps the token out of reach of page JS.
  assert.match(c, /HttpOnly/)
  // SameSite=None without Secure is rejected by browsers, so both are required
  // for the github.io -> vercel.app cookie to survive.
  assert.match(c, /SameSite=None/)
  assert.match(c, /Secure/)
  assert.match(c, /Max-Age=60/)
  // Clearing needs Max-Age=0, not an absent Max-Age.
  assert.match(cookie(TOKEN_COOKIE, '', 0), /Max-Age=0/)
})

test('parseCookies tolerates junk and decodes values', () => {
  const c = parseCookies({ headers: { cookie: 'a=1; cc_token=tok%20en; ; b=2' } })
  assert.equal(c.a, '1')
  assert.equal(c.cc_token, 'tok en')
  assert.equal(c.b, '2')
  assert.deepEqual(parseCookies({ headers: {} }), {})
})

// Minimal Express-like res so the handler can be driven without a server.
const mkRes = () => {
  const r = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v
    },
    status(c) {
      this.statusCode = c
      return this
    },
    json(b) {
      this.body = b
      this.ended = true
      return this
    },
    send(b) {
      this.body = b
      this.ended = true
      return this
    },
    end() {
      this.ended = true
      return this
    },
    redirect(c, url) {
      this.statusCode = c
      this.headers.location = url
      this.ended = true
      return this
    },
  }
  return r
}

test('unconfigured OAuth returns 501 instead of redirecting to a broken flow', async () => {
  const saved = { id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET }
  delete process.env.GITHUB_CLIENT_ID
  delete process.env.GITHUB_CLIENT_SECRET
  const handler = (await import('../api/oauth.js')).default
  const res = mkRes()
  await handler({ method: 'GET', headers: {}, url: '/api/login', query: {} }, res)
  assert.equal(res.statusCode, 501)
  assert.match(res.body.error, /not configured/)
  if (saved.id) process.env.GITHUB_CLIENT_ID = saved.id
  if (saved.secret) process.env.GITHUB_CLIENT_SECRET = saved.secret
})

test('proxy without a session cookie is refused, not proxied', async () => {
  const handler = (await import('../api/oauth.js')).default
  process.env.ALLOWED_ORIGIN = 'https://iamtyroon.github.io'
  const res = mkRes()
  await handler(
    {
      method: 'GET',
      headers: { origin: 'https://iamtyroon.github.io' },
      url: '/api/gh',
      query: {},
    },
    res,
  )
  // No cookie -> 401 before any upstream call happens.
  assert.ok([401, 400].includes(res.statusCode), `expected refusal, got ${res.statusCode}`)
})

test('proxy rejects a disallowed origin even with a cookie', async () => {
  const handler = (await import('../api/oauth.js')).default
  process.env.ALLOWED_ORIGIN = 'https://iamtyroon.github.io'
  const res = mkRes()
  await handler(
    {
      method: 'GET',
      headers: { origin: 'https://evil.example', cookie: 'cc_token=fake' },
      url: '/api/gh',
      query: {},
    },
    res,
  )
  assert.equal(res.statusCode, 403)
})

test('an absent Origin is allowed so sign-out works; a wrong one still fails', async () => {
  const handler = (await import('../api/oauth.js')).default
  process.env.ALLOWED_ORIGIN = 'https://iamtyroon.github.io'

  // Browsers omit Origin on these; rejecting it would make sign-out silently fail.
  const del = mkRes()
  await handler({ method: 'DELETE', headers: {}, url: '/api/session', query: {} }, del)
  assert.equal(del.statusCode, 204)

  // The cross-site case is still blocked.
  const cross = mkRes()
  await handler(
    {
      method: 'GET',
      headers: { origin: 'https://evil.example', cookie: 'cc_token=x' },
      url: '/api/session',
      query: {},
    },
    cross,
  )
  assert.equal(cross.statusCode, 403)
})

test('unknown routes 404 rather than falling through', async () => {
  const handler = (await import('../api/oauth.js')).default
  const res = mkRes()
  await handler({ method: 'GET', headers: {}, url: '/api/nope', query: {} }, res)
  assert.equal(res.statusCode, 404)
})

test('proxy reads ?gh=, not ?path= — the route param shadows the old name', async () => {
  const handler = (await import('../api/oauth.js')).default
  process.env.ALLOWED_ORIGIN = 'https://iamtyroon.github.io'
  // A bad token makes it fail at the upstream call, which is the proof that
  // safeGhPath ACCEPTED the path instead of 400ing before any network use.
  const res = mkRes()
  await handler(
    {
      method: 'GET',
      headers: { origin: 'https://iamtyroon.github.io', cookie: 'cc_token=definitely_not_valid' },
      url: '/api/gh',
      query: { gh: 'repos/iamtyroon/commitcard' },
    },
    res,
  )
  assert.notEqual(res.statusCode, 400, 'valid repo path must not be rejected as unsupported')
})

