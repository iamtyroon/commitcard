// OAuth broker for commitcard.
//
// github.com/login/* sends no Access-Control-Allow-Origin header, so a browser can
// never read the token exchange response (verified: the OPTIONS preflight 404s with
// no CORS headers, while api.github.com answers 204 + ACAO:*). This function is the
// missing non-browser half. It holds the client_secret, keeps the token in an
// httpOnly cookie, and hands the page a same-origin proxy instead.
import crypto from 'node:crypto'

const GH_API = 'https://api.github.com'
const GH_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const TOKEN_COOKIE = 'cc_token'
const STATE_COOKIE = 'cc_oauth_state'
const STATE_TTL = 600 // 10 min: long enough to click through GitHub, short enough to expire.
const TOKEN_TTL = 60 * 60 * 24 * 30 // 30 days.

const parseCookies = (req) => {
  const out = {}
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

// SameSite=None because the Pages site (github.io) and this function (vercel.app)
// are cross-site: Lax would withhold the cookie from the proxy fetch. Secure is
// mandatory alongside None.
const cookie = (name, value, maxAge) =>
  [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=None',
    'Secure',
    ...(maxAge == null ? [] : [`Max-Age=${maxAge}`]),
  ].join('; ')

const allowOrigin = (req, res) => {
  const origin = process.env.ALLOWED_ORIGIN
  if (!origin) return null
  // Credentialed CORS forbids a wildcard, so echo the configured origin exactly.
  // Browsers omit Origin on same-origin and many GET/DELETE requests. Rejecting
  // those would break sign-out, so treat "no Origin" as same-origin and rely on the
  // httpOnly cookie plus CSRF-by-unpredictability. A *present but wrong* Origin is
 // always rejected — that is the cross-site case CSRF actually needs blocked.
  if (!req.headers.origin) return null
  if (req.headers.origin !== origin) return null
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Vary', 'Origin')
  return origin
}

const selfUrl = (req) => {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
  return `${proto}://${req.headers.host}`
}

// Keeps this from becoming an open proxy: only the read-only prefixes the card
// needs, and never a path that could escape api.github.com.
const safeGhPath = (p) => {
  if (typeof p !== 'string' || !p) return null
  if (p.includes('..') || p.includes('://') || p.startsWith('/')) return null
  return /^(user|repos|search)(\/|\?|$)/.test(p) ? p : null
}

const ghFetch = async (token, path, init = {}) => {
  const res = await fetch(`${GH_API}/${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })
  return res
}

// Forward the quota headers so the page can report real limits instead of guessing.
const relayRateLimit = (res, upstream) => {
  for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
    const v = upstream.headers.get(h)
    if (v) res.setHeader(h, v)
  }
}

async function startLogin(req, res) {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    return res.status(501).json({
      error: 'OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
    })
  }
  const state = crypto.randomBytes(32).toString('hex')
  const url =
    'https://github.com/login/oauth/authorize' +
    `?client_id=${encodeURIComponent(clientId)}` +
    '&scope=repo' +
    `&redirect_uri=${encodeURIComponent(`${selfUrl(req)}/api/callback`)}` +
    `&state=${state}`
  res.setHeader('Set-Cookie', cookie(STATE_COOKIE, state, STATE_TTL))
  // Top-level navigation, so CORS never applies to this leg.
  return res.redirect(302, url)
}

async function finishLogin(req, res) {
  const { code, state } = req.query || {}
  const expected = parseCookies(req)[STATE_COOKIE]
  const fail = (why) => {
    res.setHeader('Set-Cookie', cookie(STATE_COOKIE, '', 0))
    return res.status(400).json({ error: why })
  }
  if (!code) return fail('missing code')
  // CSRF: the callback must match the state this browser started with.
  if (!state || !expected || state !== expected) return fail('state mismatch — restart sign-in')

  const upstream = await fetch(GH_TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${selfUrl(req)}/api/callback`,
    }),
  })
  const data = await upstream.json()
  if (!data.access_token) {
    // Never echo upstream detail back; it can describe the app config.
    return fail(data.error || 'token exchange failed')
  }
  res.setHeader('Set-Cookie', [
    cookie(TOKEN_COOKIE, data.access_token, TOKEN_TTL),
    cookie(STATE_COOKIE, '', 0),
  ])
  // The token stays server-side; the page only learns that it worked.
  return res.redirect(302, `${process.env.ALLOWED_ORIGIN}/?signedin=1`)
}

async function session(req, res) {
  const token = parseCookies(req)[TOKEN_COOKIE]
  if (!token) return res.status(401).json({ error: 'not signed in' })
  const upstream = await ghFetch(token, 'user')
  relayRateLimit(res, upstream)
  if (upstream.status === 401) {
    res.setHeader('Set-Cookie', cookie(TOKEN_COOKIE, '', 0))
    return res.status(401).json({ error: 'token rejected' })
  }
  if (!upstream.ok) return res.status(upstream.status).json({ error: 'GitHub API error' })
  const user = await upstream.json()
  return res.json({
    login: user.login,
    name: user.name,
    avatar_url: user.avatar_url,
  })
}

async function proxy(req, res) {
  const token = parseCookies(req)[TOKEN_COOKIE]
  if (!token) return res.status(401).json({ error: 'not signed in' })
  // The GitHub path comes in as ?gh=... Deliberately NOT ?path= — that name
  // collides with the [..path] route param, which silently overwrote it.
  const path = safeGhPath(typeof req.query?.gh === 'string' ? req.query.gh : null)
  if (!path) return res.status(400).json({ error: 'unsupported path' })
  const upstream = await ghFetch(token, path)
  relayRateLimit(res, upstream)
  if (upstream.status === 401) {
    res.setHeader('Set-Cookie', cookie(TOKEN_COOKIE, '', 0))
    return res.status(401).json({ error: 'token rejected' })
  }
  const body = await upstream.text()
  res.status(upstream.status)
  res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
  return res.send(body)
}

export default async function handler(req, res) {
  // Vercel did not route a catch-all filename ([...path].js), so every route is
  // rewritten here to /api/oauth and the real route is read from the URL. This is
  // the path Vercel actually preserved; `req.query.path` is empty after a rewrite.
  const url = String(req.url || '')
  const route = (url.split('?')[0].split('/').filter(Boolean)[1] || '').toLowerCase()
  try {
    if (req.method === 'OPTIONS') {
      if (!allowOrigin(req, res)) return res.status(403).end()
      return res.status(204).end()
    }
    // Credentialed CORS only where it is needed; /api/login and /api/callback are
    // plain navigations.
  if (route === 'gh' || route === 'session') {
      const allowed = allowOrigin(req, res)
      // A present-but-wrong Origin is rejected. An absent one is fine (see
      // allowOrigin) and must not be, or sign-out breaks.
      if (!allowed && req.headers.origin) {
        return res.status(403).json({ error: 'origin not allowed' })
      }
    }
    if (route === 'login') return startLogin(req, res)
    if (route === 'callback') return finishLogin(req, res)
    if (route === 'session') {
      if (req.method === 'DELETE') {
        res.setHeader('Set-Cookie', cookie(TOKEN_COOKIE, '', 0))
        return res.status(204).end()
      }
      return session(req, res)
    }
    if (route === 'gh') return proxy(req, res)
    return res.status(404).json({ error: 'not found' })
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'worker error' })
  }
}

export { parseCookies, cookie, safeGhPath, TOKEN_COOKIE, STATE_COOKIE }
