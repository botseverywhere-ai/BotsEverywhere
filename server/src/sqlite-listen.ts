import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { createApp, DEFAULT_CREATE_LIMIT, DEFAULT_WRITE_LIMIT, MAX_BODY_BYTES, readAuthEnabled, type AppEnv } from './app.js'
import { loadCatalog } from './catalog.js'
import { createMailer } from './mail.js'

const port = Number(process.env.PORT || '8787')
const host = process.env.HOST || '127.0.0.1'
const provider = (process.env.MAIL_PROVIDER || '').toLowerCase()
const authEnabled = readAuthEnabled(process.env)

if (authEnabled && process.env.NODE_ENV === 'production' && provider !== 'ses' && provider !== 'resend') {
  console.error('Set MAIL_PROVIDER to ses or resend in production. Codes are not emailed in console mode.')
  process.exit(1)
}
if (authEnabled && process.env.NODE_ENV === 'production' && !process.env.OTP_PEPPER) {
  console.error('Set OTP_PEPPER in production.')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN) {
  console.error('Set APP_ORIGIN in production, for example https://botseverywhere.ai')
  process.exit(1)
}

const botsDir = resolve(process.env.BOTS_DIR || 'bots')
const catalog = loadCatalog(botsDir)
if (!catalog.ok) {
  for (const error of catalog.errors) console.error(error)
  process.exit(1)
}

const sqlitePath = process.env.SQLITE_PATH || 'data/botseverywhere.sqlite'
if (sqlitePath !== ':memory:') mkdirSync(dirname(sqlitePath), { recursive: true })
const sqlite = new Database(sqlitePath)
if (sqlitePath !== ':memory:') sqlite.pragma('journal_mode = WAL')

const env: AppEnv = {
  appOrigin: process.env.APP_ORIGIN || 'http://127.0.0.1:5199',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  otpPepper: process.env.OTP_PEPPER || 'dev-only-otp-pepper',
  slackClientId: process.env.SLACK_CLIENT_ID,
  slackClientSecret: process.env.SLACK_CLIENT_SECRET,
  trustProxy: process.env.TRUST_PROXY === 'true',
  authEnabled,
  createLimit: DEFAULT_CREATE_LIMIT,
  writeLimit: DEFAULT_WRITE_LIMIT,
}

const app = createApp({
  sqlite,
  mailer: createMailer(process.env),
  catalog: catalog.bots,
  env,
})

const server = createServer((req, res) => {
  void handle(req, res)
})

server.listen(port, host, () => {
  console.info(`BotsEverywhere API listening on http://${host}:${port}`)
})

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    const hostHeader = req.headers.host || `${host}:${port}`
    const url = `http://${hostHeader}${req.url || '/'}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item)
      } else {
        headers.set(key, value)
      }
    }
    const method = req.method || 'GET'
    const hasBody = method !== 'GET' && method !== 'HEAD'
    let body: Buffer | undefined
    if (hasBody) {
      const read = await readChunks(req)
      if (read === 'too-big') {
        res.statusCode = 413
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'Request is too large.' }))
        return
      }
      body = Buffer.concat(read)
    }
    const response = await app.fetch(new Request(url, { method, headers, body }), {
      remoteAddress: req.socket.remoteAddress,
    })
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return
      res.setHeader(key, value)
    })
    const cookies = response.headers.getSetCookie?.() ?? []
    if (cookies.length > 0) res.setHeader('set-cookie', cookies)
    const payload = Buffer.from(await response.arrayBuffer())
    res.end(payload)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) res.statusCode = 500
    res.end(JSON.stringify({ error: 'Something went wrong.' }))
  }
}

function readChunks(req: IncomingMessage): Promise<Buffer[] | 'too-big'> {
  const declared = Number(req.headers['content-length'] || '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume()
    req.destroy()
    return Promise.resolve('too-big')
  }
  return new Promise((resolveChunks, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        settled = true
        req.destroy()
        resolveChunks('too-big')
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!settled) resolveChunks(chunks)
    })
    req.on('error', (error) => {
      if (!settled) reject(error)
    })
  })
}
