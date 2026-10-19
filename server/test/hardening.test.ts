import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHash } from '../../src/routing.ts'
import { CookieJar, createTestApp, login, readJson, sessionOf } from './helpers.ts'

describe('client address', () => {
  it('trusts X-Real-IP or the last forwarded hop, and ignores both when the proxy is off', async () => {
    const trusted = createTestApp({ env: { trustProxy: true, createLimit: 1 } })
    const anon = await anonymous(trusted.app)
    const headers = jsonHeaders(anon.csrf, anon.cookie)

    const first = await trusted.app.request('/api/teams', {
      method: 'POST',
      headers: { ...headers, 'x-forwarded-for': '198.51.100.1, 203.0.113.9', 'x-real-ip': '203.0.113.9' },
      body: JSON.stringify({ name: 'One' }),
    })
    assert.equal(first.status, 201)

    const spoofedFirstHop = await trusted.app.request('/api/teams', {
      method: 'POST',
      headers: { ...headers, 'x-forwarded-for': '198.51.100.2, 203.0.113.9' },
      body: JSON.stringify({ name: 'Spoofed' }),
    })
    assert.equal(spoofedFirstHop.status, 429)

    const otherRealIp = await trusted.app.request('/api/teams', {
      method: 'POST',
      headers: { ...headers, 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.10' },
      body: JSON.stringify({ name: 'Other' }),
    })
    assert.equal(otherRealIp.status, 201)

    const direct = createTestApp({ env: { trustProxy: false, createLimit: 1 } })
    const plain = await anonymous(direct.app)
    const directHeaders = jsonHeaders(plain.csrf, plain.cookie)
    const fromSocket = await direct.app.request(
      '/api/teams',
      {
        method: 'POST',
        headers: { ...directHeaders, 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.1' },
        body: JSON.stringify({ name: 'Socket' }),
      },
      { remoteAddress: '192.0.2.5' },
    )
    assert.equal(fromSocket.status, 201)
    const sameSocket = await direct.app.request(
      '/api/teams',
      {
        method: 'POST',
        headers: { ...directHeaders, 'x-forwarded-for': '203.0.113.50', 'x-real-ip': '203.0.113.50' },
        body: JSON.stringify({ name: 'Same socket' }),
      },
      { remoteAddress: '192.0.2.5' },
    )
    assert.equal(sameSocket.status, 429)
    const otherSocket = await direct.app.request(
      '/api/teams',
      {
        method: 'POST',
        headers: { ...directHeaders, 'x-forwarded-for': '203.0.113.50', 'x-real-ip': '203.0.113.50' },
        body: JSON.stringify({ name: 'Other socket' }),
      },
      { remoteAddress: '192.0.2.6' },
    )
    assert.equal(otherSocket.status, 201)
  })
})

describe('hash routing', () => {
  it('routes a malformed hash to the invalid link instead of throwing', () => {
    assert.equal(parseHash('#%').view, 'invalid')
    assert.equal(parseHash('#%E0%A4%A').view, 'invalid')
    assert.equal(parseHash('#home').view, 'home')
    assert.equal(parseHash('').view, 'landing')
    const opened = parseHash('#o/your-company')
    assert.equal(opened.view, 'opened')
    if (opened.view === 'opened') {
      assert.equal(opened.slug, 'your-company')
      assert.equal(opened.chart, 'work')
    }
  })
})

describe('member emails', () => {
  it('returns emails only to edit holders', async () => {
    const { app, sent } = createTestApp({ env: { authEnabled: true } })
    const owner = await login(app, sent, 'owner@example.com')
    const created = await app.request('/api/teams', {
      method: 'POST',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
      body: JSON.stringify({ name: 'Alicante' }),
    })
    assert.equal(created.status, 201)
    const createdBody = await readJson(created)
    const teamId = (createdBody.team as { id: string }).id
    const links = createdBody.links as { editUrl: string; viewUrl: string }
    const editToken = tokenFrom(links.editUrl, 'edit-')
    const viewToken = tokenFrom(links.viewUrl, 'view-')

    const editorInvite = await app.request(`/api/teams/${teamId}/invites`, {
      method: 'POST',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
      body: JSON.stringify({ email: 'editor@example.com', role: 'editor' }),
    })
    assert.equal(editorInvite.status, 201)
    const editor = await login(app, sent, 'editor@example.com')

    const viewerInvite = await app.request(`/api/teams/${teamId}/invites`, {
      method: 'POST',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
      body: JSON.stringify({ role: 'viewer' }),
    })
    const viewerUrl = ((await readJson(viewerInvite)).invite as { url: string }).url
    const viewer = await login(app, sent, 'viewer@example.com')
    const accepted = await app.request(`/api/invites/${viewerUrl.split('#invite-')[1]}/accept`, {
      method: 'POST',
      headers: jsonHeaders(viewer.csrf, viewer.jar.header()),
    })
    assert.equal(accepted.status, 200)

    const asOwner = await members(app, teamId, { cookie: owner.jar.header() })
    const asEditor = await members(app, teamId, { cookie: editor.jar.header() })
    const asViewer = await members(app, teamId, { cookie: viewer.jar.header() })
    const asEditLink = await members(app, teamId, { 'x-share-token': editToken })
    const asViewLink = await members(app, teamId, { 'x-share-token': viewToken })

    assert.ok(asOwner.some((member) => member.email === 'editor@example.com'))
    assert.ok(asEditor.some((member) => member.email === 'owner@example.com'))
    assert.ok(asEditLink.some((member) => member.email === 'owner@example.com'))
    for (const member of [...asViewer, ...asViewLink]) {
      assert.equal('email' in member, false)
      assert.equal(typeof member.role, 'string')
    }
  })
})

describe('request body cap', () => {
  it('rejects a streamed body over 100 KB and a declared Content-Length over 100 KB', async () => {
    const { app } = createTestApp()
    const anon = await anonymous(app)
    const headers = jsonHeaders(anon.csrf, anon.cookie)
    const payload = JSON.stringify({ name: 'n'.repeat(100_000) })
    assert.ok(Buffer.byteLength(payload) > 100_000)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    })
    const streamed = await app.request('/api/teams', {
      method: 'POST',
      headers,
      body: stream,
      duplex: 'half',
    })
    assert.equal(streamed.status, 413)

    const declared = await app.request(
      new Request('http://localhost/api/teams', {
        method: 'POST',
        headers: { ...headers, 'content-length': '100001' },
        body: '{"name":"Ok"}',
      }),
    )
    assert.equal(declared.status, 413)

    const ok = await app.request('/api/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Kept' }),
    })
    assert.equal(ok.status, 201)
  })
})

function jsonHeaders(csrf: string, cookie: string) {
  return { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie }
}

async function anonymous(app: ReturnType<typeof createTestApp>['app']) {
  const jar = new CookieJar()
  const session = await sessionOf(app, jar)
  return { csrf: session.csrf, cookie: jar.header() }
}

async function members(
  app: ReturnType<typeof createTestApp>['app'],
  teamId: string,
  headers: Record<string, string>,
) {
  const response = await app.request(`/api/teams/${teamId}/members`, { headers })
  assert.equal(response.status, 200)
  return (await readJson(response)).members as { email?: string; role: string }[]
}

function tokenFrom(url: string, prefix: string): string {
  const hash = new URL(url).hash.replace(/^#/, '')
  assert.ok(hash.startsWith(prefix), hash)
  return hash.slice(prefix.length)
}
