// Find a Chromium/Chrome binary and screenshot an HTML file headlessly.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, mkdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'

const pexec = promisify(execFile)

const COMMON = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
}

async function findPlaywrightChromium() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean)
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries = []
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const name of entries.filter((e) => e.startsWith('chromium')).sort().reverse()) {
      for (const rel of [
        ['chrome-win64', 'chrome.exe'],
        ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
        ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
        ['chrome-linux', 'chrome'],
        ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
      ]) {
        const bin = join(root, name, ...rel)
        if (existsSync(bin)) return bin
      }
    }
  }
  return null
}

export async function findBrowser() {
  if (process.env.COMMITCARD_BROWSER && existsSync(process.env.COMMITCARD_BROWSER))
    return process.env.COMMITCARD_BROWSER
  for (const bin of COMMON[process.platform] ?? []) {
    if (existsSync(bin)) return bin
  }
  return findPlaywrightChromium()
}

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/').replace(/^\/+/, '')}`

export async function screenshot({ html, out, width, height, scale = 2, browser }) {
  const bin = browser ?? (await findBrowser())
  if (!bin)
    throw new Error(
      'No Chromium/Chrome found. Install Chrome/Edge, or set COMMITCARD_BROWSER to a Chrome binary.',
    )
  const dir = join(tmpdir(), 'commitcard')
  await mkdir(dir, { recursive: true })
  const tmpHtml = join(dir, `card-${Date.now()}.html`)
  await writeFile(tmpHtml, html, 'utf8')
  await mkdir(dirname(out), { recursive: true })

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    // Let remote avatars / webfonts settle before capture.
    '--virtual-time-budget=5000',
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
    fileUrl(tmpHtml),
  ]
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await pexec(bin, args, { windowsHide: true, timeout: 120000 })
      const s = await stat(out)
      if (s.size > 0) return out
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr ?? new Error('screenshot failed')
}
