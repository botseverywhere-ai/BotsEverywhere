import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readAuthEnabled } from '../src/app.ts'
import { sha256 } from '../src/crypto.ts'
import { canEditSeats, canReadTeam, canRegenerateLinks, canRenameTeam } from '../src/permissions.ts'
import { CookieJar, createTestApp, readJson, sessionOf } from './helpers.ts'

describe('share-link permissions', () => {
  it('treats an edit link as read-write and a view link as read-only', () => {
    assert.equal(canReadTeam({ isSample: false, role: null, share: 'view' }), true)
    assert.equal(canEditSeats({ isSample: false, role: null, share: 'edit' }), true)
    assert.equal(canEditSeats({ isSample: false, role: null, share: 'view' }), false)
    assert.equal(canEditSeats({ isSample: true, role: null, share: 'edit' }), false)
    assert.equal(canRenameTeam({ isSample: false, role: null, share: 'edit' }), true)
    assert.equal(canRenameTeam({ isSample: false, role: 'editor' }), false)
    assert.equal(canRenameTeam({ isSample: false, role: null, share: 'view' }), false)
    assert.equal(canRegenerateLinks({ isSample: false, share: 'edit' }), true)
    assert.equal(canRegenerateLinks({ isSample: false, share: 'view' }), false)
    assert.equal(canRegenerateLinks({ isSample: false, share: null }), false)
    assert.equal(readAuthEnabled({}), false)
    assert.equal(readAuthEnabled({ AUTH_ENABLED: 'false' }), false)
    assert.equal(readAuthEnabled({ AUTH_ENABLED: 'true' }), true)
  })
})

describe('share-link teams', () => {
  it('disables email and Slack sign-in unless AUTH_ENABLED=true', async () => {
    const { app } = createTestApp()
    const anon = await anonymous(app)
    const email = await app.request('/api/auth/email/start', {
      method: 'POST',
      headers: jsonHeaders(anon.csrf, anon.cookie),
      body: JSON.stringify({ email: 'ada@example.com' }),
    })
    assert.equal(email.status, 404)
    assert.match(JSON.stringify(await readJson(email)), /disabled/i)
    const slack = await app.request('/api/auth/slack/start')
    assert.equal(slack.status, 404)
    const callback = await app.request('/api/auth/slack/callback?code=x&state=y')
    assert.equal(callback.status, 404)
    const session = await app.request('/api/session')
    assert.equal((await readJson(session)).authEnabled, false)
  })

  it('creates a team with no account and stores only token hashes', async () => {
    const { app, sqlite } = createTestApp()
    const created = await createTeam(app, 'Alicante')
    const editToken = tokenFrom(created.links.editUrl, 'edit-')
    const viewToken = tokenFrom(created.links.viewUrl, 'view-')
    assert.ok(Buffer.from(editToken, 'base64url').length >= 16)
    assert.ok(Buffer.from(viewToken, 'base64url').length >= 16)
    assert.notEqual(editToken, viewToken)

    const row = sqlite.prepare('SELECT edit_token_hash, view_token_hash FROM teams WHERE id = ?').get(created.team.id) as {
      edit_token_hash: string
      view_token_hash: string
    }
    assert.equal(row.edit_token_hash, sha256(editToken))
    assert.equal(row.view_token_hash, sha256(viewToken))
    const stored = JSON.stringify(sqlite.prepare('SELECT * FROM teams').all())
    assert.equal(stored.includes(editToken), false)
    assert.equal(stored.includes(viewToken), false)

    const listed = await app.request('/api/teams')
    assert.equal(listed.status, 401)
    const bare = await app.request(`/api/teams/${created.team.id}`)
    assert.equal(bare.status, 404)

    const sample = await app.request('/api/teams/sample/seats')
    assert.equal(sample.status, 200)
    assert.equal(sample.headers.get('x-robots-tag'), null)
    const anon = await anonymous(app)
    const sampleWrite = await app.request('/api/teams/sample/seats', {
      method: 'POST',
      headers: jsonHeaders(anon.csrf, anon.cookie),
      body: JSON.stringify({ name: 'Extra', role: 'Ops', humanOwner: 'You', botSlug: 'research' }),
    })
    assert.equal(sampleWrite.status, 403)
  })

  it('lets the edit link change the team and keeps the view link read-only', async () => {
    const { app } = createTestApp()
    const created = await createTeam(app, 'Crew')
    const editToken = tokenFrom(created.links.editUrl, 'edit-')
    const viewToken = tokenFrom(created.links.viewUrl, 'view-')
    const anon = await anonymous(app)

    const resolved = await app.request('/api/share/session', { headers: { 'x-share-token': editToken } })
    assert.equal(resolved.status, 200)
    assert.match(resolved.headers.get('x-robots-tag') ?? '', /noindex/)
    const access = (await readJson(resolved)).team as { id: string; access: string }
    assert.equal(access.id, created.team.id)
    assert.equal(access.access, 'edit')

    const renamed = await app.request(`/api/teams/${created.team.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': editToken },
      body: JSON.stringify({ name: 'Crew west' }),
    })
    assert.equal(renamed.status, 200)

    const added = await app.request(`/api/teams/${created.team.id}/seats`, {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': editToken },
      body: JSON.stringify({ name: 'Support', role: 'Follow-ups', humanOwner: 'Ada', botSlug: 'research' }),
    })
    assert.equal(added.status, 201)
    const seat = (await readJson(added)).seat as { id: string }

    const edited = await app.request(`/api/teams/${created.team.id}/seats/${seat.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': editToken },
      body: JSON.stringify({ name: 'Support desk', role: 'Follow-ups', humanOwner: 'Ada', botSlug: 'writing' }),
    })
    assert.equal(edited.status, 200)

    const viewRead = await app.request(`/api/teams/${created.team.id}/seats`, {
      headers: { 'x-share-token': viewToken },
    })
    assert.equal(viewRead.status, 200)
    const viewRename = await app.request(`/api/teams/${created.team.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': viewToken },
      body: JSON.stringify({ name: 'Hijack' }),
    })
    assert.equal(viewRename.status, 403)
    const viewAdd = await app.request(`/api/teams/${created.team.id}/seats`, {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': viewToken },
      body: JSON.stringify({ name: 'Blocked', role: 'Notes', humanOwner: 'Viewer', botSlug: null }),
    })
    assert.equal(viewAdd.status, 403)
    const viewEdit = await app.request(`/api/teams/${created.team.id}/seats/${seat.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': viewToken },
      body: JSON.stringify({ name: 'Blocked', role: 'Notes', humanOwner: 'Viewer', botSlug: null }),
    })
    assert.equal(viewEdit.status, 403)
    const viewDelete = await app.request(`/api/teams/${created.team.id}/seats/${seat.id}`, {
      method: 'DELETE',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': viewToken },
    })
    assert.equal(viewDelete.status, 403)
    const viewRegen = await app.request(`/api/teams/${created.team.id}/links`, {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': viewToken },
      body: JSON.stringify({}),
    })
    assert.equal(viewRegen.status, 403)

    const removed = await app.request(`/api/teams/${created.team.id}/seats/${seat.id}`, {
      method: 'DELETE',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': editToken },
    })
    assert.equal(removed.status, 200)

    const still = await app.request(`/api/teams/${created.team.id}`, { headers: { 'x-share-token': viewToken } })
    assert.equal(((await readJson(still)).team as { name: string }).name, 'Crew west')
  })

  it('regenerates both links and revokes the old tokens', async () => {
    const { app } = createTestApp()
    const created = await createTeam(app, 'Keys')
    const editToken = tokenFrom(created.links.editUrl, 'edit-')
    const viewToken = tokenFrom(created.links.viewUrl, 'view-')
    const anon = await anonymous(app)
    const regen = await app.request(`/api/teams/${created.team.id}/links`, {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': editToken },
      body: JSON.stringify({}),
    })
    assert.equal(regen.status, 200)
    const links = (await readJson(regen)).links as { editUrl: string; viewUrl: string }
    const nextEdit = tokenFrom(links.editUrl, 'edit-')
    const nextView = tokenFrom(links.viewUrl, 'view-')
    assert.notEqual(nextEdit, editToken)
    assert.notEqual(nextView, viewToken)

    assert.equal((await app.request('/api/share/session', { headers: { 'x-share-token': editToken } })).status, 404)
    assert.equal((await app.request('/api/share/session', { headers: { 'x-share-token': viewToken } })).status, 404)
    const renamed = await app.request(`/api/teams/${created.team.id}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': nextEdit },
      body: JSON.stringify({ name: 'Keys rotated' }),
    })
    assert.equal(renamed.status, 200)
    const view = await app.request('/api/share/session', { headers: { 'x-share-token': nextView } })
    assert.equal(((await readJson(view)).team as { access: string }).access, 'view')
  })

  it('rate-limits team creation and later API writes', async () => {
    const { app } = createTestApp({ env: { createLimit: 2, writeLimit: 2 } })
    assert.equal((await createTeam(app, 'One')).status, 201)
    assert.equal((await createTeam(app, 'Two')).status, 201)
    const blocked = await createTeam(app, 'Three')
    assert.equal(blocked.status, 429)

    const { app: writer } = createTestApp({ env: { writeLimit: 2 } })
    const created = await createTeam(writer, 'Writes')
    const editToken = tokenFrom(created.links.editUrl, 'edit-')
    const anon = await anonymous(writer)
    async function add(name: string) {
      return writer.request(`/api/teams/${created.team.id}/seats`, {
        method: 'POST',
        headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-share-token': editToken },
        body: JSON.stringify({ name, role: 'Notes', humanOwner: 'Ada', botSlug: null }),
      })
    }
    assert.equal((await add('A')).status, 201)
    assert.equal((await add('B')).status, 201)
    assert.equal((await add('C')).status, 429)
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

async function createTeam(app: ReturnType<typeof createTestApp>['app'], name: string) {
  const anon = await anonymous(app)
  const response = await app.request('/api/teams', {
    method: 'POST',
    headers: jsonHeaders(anon.csrf, anon.cookie),
    body: JSON.stringify({ name }),
  })
  const body = response.status === 201 ? await readJson(response) : {}
  return {
    status: response.status,
    team: (body.team ?? {}) as { id: string; name: string },
    links: (body.links ?? {}) as { editUrl: string; viewUrl: string },
  }
}

function tokenFrom(url: string, prefix: string): string {
  const hash = new URL(url).hash.replace(/^#/, '')
  assert.ok(hash.startsWith(prefix))
  return hash.slice(prefix.length)
}
