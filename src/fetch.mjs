// Commit collection backends: GitHub API via `gh`, GitHub API via fetch, or local git.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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

// Pull commit list + per-commit file stats for a branch within [from, to] epoch ms.
export async function collectFromGitHub({
  repo,
  ref,
  from,
  to,
  api: prefer,
  concurrency = 6,
  onProgress,
}) {
  const api = await pickApi(prefer)
  const meta = await api(`repos/${repo}`)
  const branch = ref || meta.default_branch
  const list = await api(
    `repos/${repo}/commits?sha=${branch}&since=${iso(from)}&until=${iso(to)}&per_page=100`,
  )
  if (!Array.isArray(list)) throw new Error('unexpected commit-list response')

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
