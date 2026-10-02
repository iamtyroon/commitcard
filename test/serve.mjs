// Tiny static server for local manual testing of index.html.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
}
const port = Number(process.argv[2] || 4321)

createServer(async (req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0])
  if (rel === '/') rel = '/index.html'
  const file = join(ROOT, rel)
  // Never serve outside the repo.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, () => console.log('serving on http://localhost:' + port))
