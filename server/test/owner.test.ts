import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sha256 } from '../src/crypto.ts'
import { CookieJar, createTestApp, readJson, sessionOf } from './helpers.ts'

describe('owner link', () => {
  it('opens the organization with the owner token and stores only its hash', async () => {
    const { app, sqlite } = createTestApp()
    const anon = await anonymous(app)
    const created = await app.request('/api/organizations', {
      method: 'POST',
      headers: jsonHeaders(anon.csrf, anon.cookie),
      body: JSON.stringify({ name: 'North office' }),
    })
    assert.equal(created.status, 201)
    assert.match(created.headers.get('x-robots-tag') ?? '', /noindex/)
    const body = await readJson(created)
    const ownerUrl = String(body.ownerUrl)
    const ownerToken = tokenFrom(ownerUrl, 'owner/')
    assert.equal(Buffer.from(ownerToken, 'base64url').length, 32)

    const row = sqlite.prepare('SELECT owner_token_hash FROM organizations').get() as { owner_token_hash: string }
    assert.equal(row.owner_token_hash, sha256(ownerToken))
    const stored = JSON.stringify(sqlite.prepare('SELECT id, name, owner_token_hash, created_at FROM organizations').all())
    assert.equal(stored.includes(ownerToken), false)

    const session = await app.request('/api/owner/session', { headers: { 'x-owner-token': ownerToken } })
    assert.equal(session.status, 200)
    assert.match(session.headers.get('x-robots-tag') ?? '', /noindex/)
    const dashboard = await readJson(session)
    assert.equal((dashboard.organization as { name: string }).name, 'North office')
    assert.deepEqual(dashboard.teams, [])

    const team = await app.request('/api/teams', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ name: 'Implementation' }),
    })
    assert.equal(team.status, 201)
    const teamBody = await readJson(team)
    const teamId = (teamBody.team as { id: string }).id
    const attached = sqlite.prepare('SELECT organization_id, edit_token_hash, link_seal FROM teams WHERE id = ?').get(teamId) as {
      organization_id: string
      edit_token_hash: string
      link_seal: string
    }
    assert.equal(attached.organization_id, (body.organization as { id: string }).id)
    const editToken = tokenFrom((teamBody.links as { editUrl: string }).editUrl, 'edit-')
    assert.equal(attached.edit_token_hash, sha256(editToken))
    assert.equal(attached.link_seal.includes(editToken), false)

    const again = await app.request('/api/owner/session', { headers: { 'x-owner-token': ownerToken } })
    const listed = ((await readJson(again)).teams as { name: string; editUrl: string }[])[0]
    assert.equal(listed?.name, 'Implementation')
    assert.equal(listed?.editUrl, (teamBody.links as { editUrl: string }).editUrl)

    const seat = await app.request(`/api/teams/${teamId}/seats`, {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ name: 'Research', role: 'Briefs', humanOwner: 'Sam', botSlug: 'research' }),
    })
    assert.equal(seat.status, 201)
  })

  it('does not open the organization with a team view token', async () => {
    const { app } = createTestApp()
    const anon = await anonymous(app)
    const ownerToken = await createOrg(app, anon, 'North office')
    const created = await app.request('/api/teams', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ name: 'Implementation' }),
    })
    const links = (await readJson(created)).links as { viewUrl: string; editUrl: string }
    const viewToken = tokenFrom(links.viewUrl, 'view-')

    const asOwner = await app.request('/api/owner/session', { headers: { 'x-owner-token': viewToken } })
    assert.equal(asOwner.status, 404)

    const claim = await app.request('/api/owner/claim', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ editLink: links.viewUrl }),
    })
    assert.equal(claim.status, 403)
  })

  it('regenerating the owner link invalidates the old one', async () => {
    const { app } = createTestApp()
    const anon = await anonymous(app)
    const ownerToken = await createOrg(app, anon, 'North office')
    await app.request('/api/teams', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ name: 'Implementation' }),
    })

    const regenerated = await app.request('/api/owner/regenerate', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
    })
    assert.equal(regenerated.status, 200)
    const nextToken = tokenFrom(String((await readJson(regenerated)).ownerUrl), 'owner/')
    assert.notEqual(nextToken, ownerToken)

    assert.equal((await app.request('/api/owner/session', { headers: { 'x-owner-token': ownerToken } })).status, 404)
    const session = await app.request('/api/owner/session', { headers: { 'x-owner-token': nextToken } })
    assert.equal(session.status, 200)
    const teams = (await readJson(session)).teams as { name: string; editUrl: string }[]
    assert.equal(teams[0]?.name, 'Implementation')
    assert.match(teams[0]?.editUrl ?? '', /#edit-/)
  })

  it('claims a team with its edit link and rejects a view link', async () => {
    const { app } = createTestApp()
    const anon = await anonymous(app)
    const ownerToken = await createOrg(app, anon, 'North office')
    const loose = await app.request('/api/teams', {
      method: 'POST',
      headers: jsonHeaders(anon.csrf, anon.cookie),
      body: JSON.stringify({ name: 'Field team' }),
    })
    assert.equal(loose.status, 201)
    const links = (await readJson(loose)).links as { editUrl: string; viewUrl: string }
    const oldEdit = tokenFrom(links.editUrl, 'edit-')

    const denied = await app.request('/api/owner/claim', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ editLink: links.viewUrl }),
    })
    assert.equal(denied.status, 403)

    const claimed = await app.request('/api/owner/claim', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ editLink: links.editUrl }),
    })
    assert.equal(claimed.status, 200)
    const claimBody = await readJson(claimed)
    assert.equal(claimBody.replacedLinks, true)
    const nextEdit = tokenFrom((claimBody.links as { editUrl: string }).editUrl, 'edit-')
    assert.notEqual(nextEdit, oldEdit)
    assert.equal((await app.request('/api/share/session', { headers: { 'x-share-token': oldEdit } })).status, 404)
    assert.equal((await app.request('/api/share/session', { headers: { 'x-share-token': nextEdit } })).status, 200)

    const session = await app.request('/api/owner/session', { headers: { 'x-owner-token': ownerToken } })
    const teams = (await readJson(session)).teams as { name: string; editUrl: string; viewUrl: string }[]
    assert.equal(teams.length, 1)
    assert.equal(teams[0]?.name, 'Field team')
    assert.equal(teams[0]?.editUrl, (claimBody.links as { editUrl: string }).editUrl)
    assert.match(teams[0]?.viewUrl ?? '', /#view-/)
  })

  it('rate-limits organization creation', async () => {
    const { app } = createTestApp({ env: { createLimit: 2 } })
    const anon = await anonymous(app)
    assert.equal((await postOrg(app, anon, 'One')).status, 201)
    assert.equal((await postOrg(app, anon, 'Two')).status, 201)
    assert.equal((await postOrg(app, anon, 'Three')).status, 429)
  })
})

function jsonHeaders(csrf: string, cookie: string) {
  return {
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    cookie,
  }
}

async function anonymous(app: ReturnType<typeof createTestApp>['app']) {
  const jar = new CookieJar()
  const session = await sessionOf(app, jar)
  return { csrf: session.csrf, cookie: jar.header() }
}

async function postOrg(
  app: ReturnType<typeof createTestApp>['app'],
  anon: { csrf: string; cookie: string },
  name: string,
) {
  return app.request('/api/organizations', {
    method: 'POST',
    headers: jsonHeaders(anon.csrf, anon.cookie),
    body: JSON.stringify({ name }),
  })
}

async function createOrg(
  app: ReturnType<typeof createTestApp>['app'],
  anon: { csrf: string; cookie: string },
  name: string,
) {
  const response = await postOrg(app, anon, name)
  assert.equal(response.status, 201)
  return tokenFrom(String((await readJson(response)).ownerUrl), 'owner/')
}

function tokenFrom(url: string, prefix: string): string {
  const hash = new URL(url).hash.replace(/^#/, '')
  assert.ok(hash.startsWith(prefix), hash)
  return hash.slice(prefix.length)
}
