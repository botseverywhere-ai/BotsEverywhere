import Database from 'better-sqlite3'
import { createApp, type AppEnv } from '../src/app.ts'
import type { CatalogBot } from '../src/frontmatter.ts'
import type { Mailer, OutboundMail } from '../src/mail.ts'

export const catalog: CatalogBot[] = [
  {
    slug: 'research',
    name: 'Research',
    category: 'research',
    integrations: ['Grok Bot'],
    contributor: 'miguel',
    addedAt: '2026-10-01',
    summary: 'Facts and briefs.',
  },
  {
    slug: 'writing',
    name: 'Social Post Bot',
    category: 'writing',
    integrations: ['Grok Bot', 'X'],
    contributor: 'miguel',
    addedAt: '2026-10-01',
    summary: 'Posts.',
  },
]

export function testEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    appOrigin: 'http://127.0.0.1:5199',
    cookieSecure: false,
    otpPepper: 'test-pepper',
    slackClientId: 'slack-client',
    slackClientSecret: 'slack-secret',
    trustProxy: true,
    authEnabled: false,
    createLimit: 8,
    writeLimit: 60,
    ...overrides,
  }
}

export function createTestApp(input?: {
  now?: () => number
  env?: Partial<AppEnv>
  fetchImpl?: typeof fetch
}) {
  const sqlite = new Database(':memory:')
  const sent: OutboundMail[] = []
  const mailer: Mailer = {
    async send(mail) {
      sent.push(mail)
    },
  }
  const app = createApp({
    sqlite,
    mailer,
    catalog,
    env: testEnv(input?.env),
    now: input?.now,
    fetchImpl: input?.fetchImpl,
  })
  return { app, sent, sqlite }
}

export class CookieJar {
  private values = new Map<string, string>()

  absorb(response: Response) {
    const lines = response.headers.getSetCookie?.() ?? []
    for (const line of lines) {
      const pair = line.split(';')[0] ?? ''
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (!value) this.values.delete(name)
      else this.values.set(name, value)
    }
  }

  header(): string {
    return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

export async function sessionOf(app: ReturnType<typeof createTestApp>['app'], jar: CookieJar) {
  const response = await app.request('/api/session', { headers: { cookie: jar.header() } })
  jar.absorb(response)
  const body = await readJson(response)
  return { response, body, csrf: String(body.csrfToken ?? '') }
}

export async function login(app: ReturnType<typeof createTestApp>['app'], sent: OutboundMail[], email: string) {
  const jar = new CookieJar()
  const session = await sessionOf(app, jar)
  const start = await app.request('/api/auth/email/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      'x-csrf-token': session.csrf,
    },
    body: JSON.stringify({ email }),
  })
  if (start.status !== 200) throw new Error(`start failed ${start.status} ${await start.text()}`)
  const code = sent.at(-1)?.code
  if (!code) throw new Error('mailer did not capture a code')
  const verify = await app.request('/api/auth/email/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      'x-csrf-token': session.csrf,
    },
    body: JSON.stringify({ email, code }),
  })
  jar.absorb(verify)
  const body = await readJson(verify)
  return { jar, csrf: String(body.csrfToken ?? ''), body, status: verify.status }
}
