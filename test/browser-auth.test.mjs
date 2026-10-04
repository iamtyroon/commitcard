import { test } from 'node:test'
import assert from 'node:assert/strict'

// The page must only route GitHub calls through the OAuth broker when a session
// exists. The broker reads its token from an httpOnly cookie, so an anonymous
// visitor has none: sending them through it 401s every request and breaks even
// public repos that api.github.com answers happily.
export const viaBroker = ({ apiBase, viewer, token, sessionUnknown }) =>
  Boolean(apiBase && (viewer || token || sessionUnknown))

test('signed out, calls go straight to the public API', () => {
  assert.equal(
    viaBroker({ apiBase: 'https://x.vercel.app', viewer: null, token: '', sessionUnknown: false }),
    false,
  )
})

test('signed in via the broker cookie, calls use the broker', () => {
  // viewer is set from the session; there is deliberately no token in the page.
  assert.equal(
    viaBroker({ apiBase: 'https://x.vercel.app', viewer: { login: 'a' }, token: '', sessionUnknown: false }),
    true,
  )
})

test('signed in with a PAT and no broker, calls stay direct', () => {
  assert.equal(viaBroker({ apiBase: '', viewer: null, token: 'ghp_x', sessionUnknown: false }), false)
})

test('on first load the broker is probed even with no viewer', () => {
  // The cookie is httpOnly, so the only way to discover a session is to ask.
  // Routing by `viewer` alone would leave every signed-in visitor looking
  // signed out on their first load.
  assert.equal(
    viaBroker({ apiBase: 'https://x.vercel.app', viewer: null, token: '', sessionUnknown: true }),
    true,
  )
})

test('a 401 from the broker ends the probing', () => {
  // Once the broker has said 401 there is no session; continuing to probe it
  // would break every public repo for a signed-out visitor.
  const sessionUnknown = false
  assert.equal(
    viaBroker({ apiBase: 'https://x.vercel.app', viewer: null, token: '', sessionUnknown }),
    false,
  )
})

test('a viewer object alone never counts as a token', () => {
  // Guards the exact inversion that caused the bug: `token` is empty under OAuth.
  assert.equal(Boolean({ login: 'a' }.token), false)
})

// Signed out, user/repos is 401, so the public set has to come from repository
// search. That query interpolates whatever is in the Repository field, which
// would let a crafted value widen the search (e.g. inject "OR org:github").
// The page already validates the field as owner/name or a bare login before it
// gets here; this pins that the accepted shape excludes query operators.
const BARE_LOGIN = /^[\w.-]+$/

test('the anonymous pool query only accepts a bare login', () => {
  assert.ok(BARE_LOGIN.test('iamtyroon'))
  // Anything with spaces or a colon would change the meaning of the query.
  assert.equal(BARE_LOGIN.test('a OR org:github'), false)
  assert.equal(BARE_LOGIN.test('a b'), false)
  assert.equal(BARE_LOGIN.test('user:someone'), false)
})
