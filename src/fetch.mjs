// Commit collection backends: GitHub API via `gh`, GitHub API via fetch, or local git.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isBot } from './aggregate.mjs'

const pexec = promisify(execFile)

export async function which(bin) {
  try {
    await pexec(bin, ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

const ghApi = async (endpoint) => {
  const { stdout } = await pexec('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    windowsHide: true,
  })
  return JSON.parse(stdout)
}

const httpApi = async (endpoint) => {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'commitcard' }
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const res = await fetch(`https://api.github.com/${endpoint}`, { headers })
  if (!res.ok) {
    const hint =
      res.status === 404
        ? ' (private repo? authenticate with `gh auth login` or set GITHUB_TOKEN)'
        : ''
    throw new Error(`GitHub API ${res.status} on ${endpoint}${hint}`)
  }
  return res.json()
}

const pickApi = async (prefer) => {
  if (prefer === 'http') return httpApi
  if (prefer === 'gh') {
    if (!(await which('gh'))) throw new Error('`gh` requested but not installed')
    return ghApi
  }
  if (await which('gh')) return ghApi
  return httpApi
}

const iso = (ms) => new Date(ms).toISOString()

// Every accessible repo, newest push first. `pushed_at` is the cheap pre-filter
// that keeps a cross-repo scan down to one call per *active* repo.
async function listAccessibleRepos(api) {
  const out = []
  for (let page = 1; page <= 10; page++) {
    const batch = await api(
      `user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=${page}`,
    )
    if (!Array.isArray(batch)) throw new Error('unexpected repo-list response')
    out.push(...batch)
    if (batch.length < 100) break
  }
  return out
}

// Pull commit list + per-commit file stats for a branch within [from, to] epoch ms.
export async function collectFromGitHub({
  repo,
  ref,
  from,
  to,
  api: prefer,
  concurrency = 6,
  maxCommits = 1000,
  onProgress,
}) {
  const api = await pickApi(prefer)
  const meta = await api(`repos/${repo}`)
  const branch = ref || meta.default_branch

  // Paginate so multi-day ranges are exact instead of stopping at page 1.
  const perPage = 100
  const list = []
  let truncated = false
  for (let page = 1; list.length < maxCommits; page++) {
    const batch = await api(
      `repos/${repo}/commits?sha=${branch}&since=${iso(from)}&until=${iso(to)}&per_page=${perPage}&page=${page}`,
    )
    if (!Array.isArray(batch)) throw new Error('unexpected commit-list response')
    list.push(...batch)
    if (batch.length < perPage) break
    if (list.length >= maxCommits) {
      truncated = true
      break
    }
  }
  if (list.length > maxCommits) list.length = maxCommits

  const commits = []
  let done = 0
  for (let i = 0; i < list.length; i += concurrency) {
    const slice = list.slice(i, i + concurrency)
    const details = await Promise.all(
      slice.map((c) => api(`repos/${repo}/commits/${c.sha}?per_page=300`)),
    )
    for (const full of details) {
      const files = full.files ?? []
      commits.push({
        sha: full.sha,
        shortSha: full.sha.slice(0, 7),
        subject: full.commit.message.split('\n')[0],
        author: full.commit.author?.name ?? 'unknown',
        avatar: full.author?.avatar_url ?? null,
        authorLogin: full.author?.login ?? null,
        committedAt: Date.parse(full.commit.committer?.date ?? full.commit.author.date),
        files: files.length,
        additions: files.reduce((a, f) => a + (f.additions ?? 0), 0),
        deletions: files.reduce((a, f) => a + (f.deletions ?? 0), 0),
        paths: files.map((f) => f.filename),
      })
    }
    done += slice.length
    onProgress?.(done, list.length)
  }
  return {
    commits,
    branch,
    repo: meta.full_name ?? repo,
    private: meta.private === true,
    ownerLogin: meta.owner?.login ?? null,
    ownerAvatar: meta.owner?.avatar_url ?? null,
    truncated,
  }
}

// Cross-repo aggregate: every commit reachable by the signed-in account across all
// of its public and private repos, within [from, to].
//
// Deliberately NOT built on search/commits. That endpoint filters on
// `author:<login>`, so it silently drops any commit authored under a different git
// identity (an agent email, a work machine, a .mailmap alias). Enumerating repos
// and reading each repo's own history counts by reachability instead, which is
// what "all my commits" actually has to mean to be correct.
export async function collectAcrossRepos({
  owner,
  from,
  to,
  api: prefer,
  concurrency = 6,
  maxCommits = 1000,
  includeBots = false,
  onProgress,
}) {
  const api = await pickApi(prefer)
  const viewer = await api('user')
  const login = typeof owner === 'string' && owner.trim() ? owner.trim() : viewer.login
  if (login.toLowerCase() !== viewer.login.toLowerCase()) {
    // Repo-level read access only exists for the signed-in account. Refuse rather
    // than silently returning public repos only and calling it a total.
    throw new Error(
      `Cross-repo stats need your own account. Signed in as @${viewer.login}, ` +
        `so "${login}" cannot be scanned.`,
    )
  }

  const repos = (await listAccessibleRepos(api))
    .filter((r) => r.pushed_at && Date.parse(r.pushed_at) >= from)
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))

  // Pass one: commit lists per active repo. One page covers most repos outright.
  const perRepo = []
  let seen = 0
  let truncated = false
  for (const r of repos) {
    if (seen >= maxCommits) {
      truncated = true
      break
    }
    const list = []
    for (let page = 1; page <= 10; page++) {
      const batch = await api(
        `repos/${r.full_name}/commits?since=${iso(from)}&until=${iso(to)}&per_page=100&page=${page}`,
      )
      if (!Array.isArray(batch)) break
      list.push(...batch)
      if (batch.length < 100) break
    }
    if (list.length) {
      seen += list.length
      perRepo.push({ repo: r.full_name, commits: list })
    }
  }

  // Author identity only exists on the per-commit detail, so bot filtering has to
  // happen after the second pass — not here.
  const flat = perRepo.flatMap((r) => r.commits.map((c) => ({ sha: c.sha, repo: r.repo })))
  if (flat.length > maxCommits) {
    flat.length = maxCommits
    truncated = true
  }

  const commits = []
  let done = 0
  let skippedBots = 0
  for (let i = 0; i < flat.length; i += concurrency) {
    const slice = flat.slice(i, i + concurrency)
    const details = await Promise.all(
      slice.map((c) => api(`repos/${c.repo}/commits/${c.sha}?per_page=300`)),
    )
    for (const [n, full] of details.entries()) {
      const files = full.files ?? []
      const commit = {
        sha: full.sha,
        shortSha: full.sha.slice(0, 7),
        subject: full.commit.message.split('\n')[0],
        author: full.commit.author?.name ?? 'unknown',
        avatar: full.author?.avatar_url ?? null,
        authorLogin: full.author?.login ?? null,
        committedAt: Date.parse(full.commit.committer?.date ?? full.commit.author.date),
        files: files.length,
        additions: files.reduce((a, f) => a + (f.additions ?? 0), 0),
        deletions: files.reduce((a, f) => a + (f.deletions ?? 0), 0),
        paths: files.map((f) => f.filename),
        // Promise.all preserves order, so the slice index maps back to the repo.
        repo: slice[n].repo,
      }
      if (includeBots || !isBot(commit)) commits.push(commit)
      else skippedBots++
    }
    done += slice.length
    onProgress?.(done, flat.length, repos.length)
  }

  return {
    commits,
    branch: `${perRepo.length} repo${perRepo.length === 1 ? '' : 's'}`,
    repo: viewer.login,
    private: null,
    ownerLogin: viewer.login,
    ownerAvatar: viewer.avatar_url ?? null,
    reposScanned: repos.length,
    reposWithCommits: perRepo.length,
    skippedBots,
    truncated,
  }
}

// Local fallback: works in any git repo without network or gh.
export async function collectFromLocalGit({ cwd, from, to, maxCount = 100 }) {
  const range = `${iso(from)}..${iso(to)}`
  const { stdout } = await pexec(
    'git',
    [
      'log',
      `--since=${iso(from)}`,
      `--until=${iso(to)}`,
      `--max-count=${maxCount}`,
      '--no-merges',
      '--numstat',
      '--pretty=format:%H%x1f%an%x1f%at%x1f%s',
    ],
    { cwd, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true },
  )
  const commits = []
  let cur = null
  for (const line of stdout.split('\n')) {
    if (line.includes('\u001f') && !/^\s*\d/.test(line)) {
      const [sha, author, at, subject] = line.split('\u001f')
      if (sha) {
        cur = {
          sha,
          shortSha: sha.slice(0, 7),
          subject: (subject ?? '').trim(),
          author,
          avatar: null,
          authorLogin: null,
          committedAt: Number(at) * 1000,
          files: 0,
          additions: 0,
          deletions: 0,
          paths: [],
        }
        commits.push(cur)
      }
      continue
    }
    if (!cur) continue
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
    if (m) {
      cur.files += 1
      if (m[1] !== '-') cur.additions += Number(m[1])
      if (m[2] !== '-') cur.deletions += Number(m[2])
      cur.paths.push(m[3])
    }
  }
  return { commits, branch: 'HEAD', repo: cwd, private: null, range }
}
