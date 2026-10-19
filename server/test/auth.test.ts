import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMAIL_SEND_LIMIT } from '../src/app.ts'
import { canEditSeats, canManageTeam, canReadTeam } from '../src/permissions.ts'
import { CookieJar, createTestApp, login, readJson, sessionOf } from './helpers.ts'

describe('team permission rules', () => {
  it('lets anyone read the sample team and only members read a private team', () => {
    assert.equal(canReadTeam({ isSample: true, role: null }), true)
    assert.equal(canReadTeam({ isSample: false, role: null }), false)
    assert.equal(canReadTeam({ isSample: false, role: 'viewer' }), true)
  })

  it('lets editors change seats and only owners manage the team', () => {
    assert.equal(canEditSeats({ isSample: false, role: 'editor' }), true)
    assert.equal(canEditSeats({ isSample: false, role: 'viewer' }), false)
    assert.equal(canEditSeats({ isSample: true, role: 'owner' }), false)
    assert.equal(canManageTeam({ isSample: false, role: 'owner' }), true)
    assert.equal(canManageTeam({ isSample: false, role: 'editor' }), false)
  })
})

describe('email sign-in', () => {
  it('reports auth as enabled and rejects a mutation without the CSRF header', async () => {
    const { app } = createTestApp({ env: { authEnabled: true } })
    const session = await app.request('/api/session')
    assert.equal((await readJson(session)).authEnabled, true)
    const response = await app.request('/api/auth/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    })
    assert.equal(response.status, 403)
  })

  it('signs in with a 6-digit code and sets an httpOnly session cookie', async () => {
    const { app, sent } = createTestApp({ env: { authEnabled: true } })
    const result = await login(app, sent, 'Ada@Example.com')
    assert.equal(result.status, 200)
    const user = result.body.user as { email: string }
    assert.equal(user.email, 'ada@example.com')
    assert.match(result.jar.header(), /be_session=/)
    const session = await sessionOf(app, result.jar)
    const again = session.body.user as { email: string }
    assert.equal(again.email, 'ada@example.com')
    const setCookie = result.body
    void setCookie
    const raw = sent[0]?.text ?? ''
    assert.match(raw, /\d{6}/)
    assert.equal(sent[0]?.code?.length, 6)
  })

  it('expires a code after 10 minutes and rate-limits repeats', async () => {
    let clock = Date.parse('2026-10-14T12:00:00Z')
    const { app, sent } = createTestApp({ now: () => clock, env: { authEnabled: true } })
    const jar = new CookieJar()
    const session = await sessionOf(app, jar)
    async function start(email = 'ada@example.com') {
      return app.request('/api/auth/email/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: jar.header(),
          'x-csrf-token': session.csrf,
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ email }),
      })
    }
    const started = await start()
    assert.equal(started.status, 200)
    const code = sent[0]?.code
    clock += 11 * 60 * 1000
    const expired = await app.request('/api/auth/email/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jar.header(),
        'x-csrf-token': session.csrf,
      },
      body: JSON.stringify({ email: 'ada@example.com', code }),
    })
    assert.equal(expired.status, 401)
    const body = await readJson(expired)
    assert.match(String(body.error), /expired/i)

    clock = Date.parse('2026-10-14T13:00:00Z')
    const fresh = new CookieJar()
    const freshSession = await sessionOf(app, fresh)
    for (let i = 0; i < EMAIL_SEND_LIMIT; i += 1) {
      const response = await app.request('/api/auth/email/start', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: fresh.header(),
          'x-csrf-token': freshSession.csrf,
          'x-forwarded-for': '203.0.113.20',
        },
        body: JSON.stringify({ email: 'rate@example.com' }),
      })
      assert.equal(response.status, 200)
    }
    const limited = await app.request('/api/auth/email/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: fresh.header(),
        'x-csrf-token': freshSession.csrf,
        'x-forwarded-for': '203.0.113.20',
      },
      body: JSON.stringify({ email: 'rate@example.com' }),
    })
    assert.equal(limited.status, 429)
  })

  it('rejects a wrong code and does not reveal the real one', async () => {
    const { app, sent } = createTestApp({ env: { authEnabled: true } })
    const jar = new CookieJar()
    const session = await sessionOf(app, jar)
    await app.request('/api/auth/email/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jar.header(),
        'x-csrf-token': session.csrf,
      },
      body: JSON.stringify({ email: 'ada@example.com' }),
    })
    const wrong = await app.request('/api/auth/email/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jar.header(),
        'x-csrf-token': session.csrf,
      },
      body: JSON.stringify({ email: 'ada@example.com', code: '000000' }),
    })
    assert.equal(wrong.status, 401)
    const text = JSON.stringify(await readJson(wrong))
    assert.equal(text.includes(sent[0]?.code ?? 'missing'), false)
  })
})

describe('Slack workspace auto-join', () => {
  it('makes the first workspace member the owner and the next an editor', async () => {
    const { app } = createTestApp({
      env: { authEnabled: true },
      fetchImpl: async (url, init) => {
        const target = String(url)
        if (target.includes('openid.connect.token')) {
          const params = new URLSearchParams(String(init?.body ?? ''))
          return Response.json({ ok: true, access_token: `token-${params.get('code')}` })
        }
        if (target.includes('userInfo')) {
          const header = new Headers(init?.headers)
          const token = header.get('authorization') ?? ''
          const email = token.endsWith('code-b') ? 'bea@example.com' : 'ada@example.com'
          return Response.json({
            ok: true,
            email,
            name: email,
            sub: email,
            'https://slack.com/team_id': 'TSPACE',
            'https://slack.com/team_name': 'Acme',
            'https://slack.com/user_id': email,
          })
        }
        return new Response('missing', { status: 404 })
      },
    })

    const first = await slackLogin(app, 'code-a')
    assert.equal(first.teams.length, 1)
    assert.equal(first.teams[0]?.role, 'owner')
    assert.equal(first.teams[0]?.name, 'Acme')

    const second = await slackLogin(app, 'code-b')
    assert.equal(second.teams.length, 1)
    assert.equal(second.teams[0]?.id, first.teams[0]?.id)
    assert.equal(second.teams[0]?.role, 'editor')
  })
})

async function slackLogin(app: ReturnType<typeof createTestApp>['app'], code: string) {
  const start = await app.request('/api/auth/slack/start?return=teams')
  assert.equal(start.status, 302)
  const location = new URL(start.headers.get('location') ?? 'http://invalid')
  const state = location.searchParams.get('state') ?? ''
  const jar = new CookieJar()
  jar.absorb(start)
  const callback = await app.request(`/api/auth/slack/callback?code=${code}&state=${state}`, {
    headers: { cookie: jar.header() },
  })
  assert.equal(callback.status, 302)
  jar.absorb(callback)
  const session = await sessionOf(app, jar)
  const teams = session.body.teams as { id: string; name: string; role: string }[]
  return { teams, jar, csrf: session.csrf }
}
