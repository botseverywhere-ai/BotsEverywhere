import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTestApp, login, readJson } from './helpers.ts'

describe('private teams', () => {
  it('serves the sample team without a login and rejects writes', async () => {
    const { app } = createTestApp()
    const seats = await app.request('/api/teams/sample/seats')
    assert.equal(seats.status, 200)
    const listed = (await readJson(seats)).seats as unknown[]
    assert.ok(listed.length >= 4)

    const jar = await anonymous(app)
    const write = await app.request('/api/teams/sample/seats', {
      method: 'POST',
      headers: jsonHeaders(jar.csrf, jar.cookie),
      body: JSON.stringify({ name: 'Extra', role: 'Ops', humanOwner: 'You', botSlug: 'research' }),
    })
    assert.equal(write.status, 403)

    const hidden = await app.request('/api/teams')
    assert.equal(hidden.status, 401)
  })

  it('hides a private team from non-members and enforces owner, editor, and viewer', async () => {
    const { app, sent } = createTestApp({ env: { authEnabled: true } })
    const owner = await login(app, sent, 'owner@example.com')
    const created = await app.request('/api/teams', {
      method: 'POST',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
      body: JSON.stringify({ name: 'Alicante' }),
    })
    assert.equal(created.status, 201)
    const team = (await readJson(created)).team as { id: string }
    const outsider = await login(app, sent, 'outsider@example.com')
    const missing = await app.request(`/api/teams/${team.id}`, {
      headers: { cookie: outsider.jar.header() },
    })
    assert.equal(missing.status, 404)

    const invite = await app.request(`/api/teams/${team.id}/invites`, {
      method: 'POST',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
      body: JSON.stringify({ email: 'editor@example.com', role: 'editor' }),
    })
    assert.equal(invite.status, 201)
    const editorUrl = ((await readJson(invite)).invite as { url: string }).url
    const editorToken = editorUrl.split('#invite-')[1] ?? ''
    const editor = await login(app, sent, 'editor@example.com')
    assert.equal((editor.body.teams as { role: string }[])[0]?.role, 'editor')

    const viewerInvite = await app.request(`/api/teams/${team.id}/invites`, {
      method: 'POST',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
      body: JSON.stringify({ role: 'viewer' }),
    })
    const viewerUrl = ((await readJson(viewerInvite)).invite as { url: string }).url
    const viewerToken = viewerUrl.split('#invite-')[1] ?? ''
    const viewerLogin = await login(app, sent, 'viewer@example.com')
    const accepted = await app.request(`/api/invites/${viewerToken}/accept`, {
      method: 'POST',
      headers: jsonHeaders(viewerLogin.csrf, viewerLogin.jar.header()),
    })
    assert.equal(accepted.status, 200)

    const editorRename = await app.request(`/api/teams/${team.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(editor.csrf, editor.jar.header()),
      body: JSON.stringify({ name: 'Nope' }),
    })
    assert.equal(editorRename.status, 403)

    const viewerSeat = await app.request(`/api/teams/${team.id}/seats`, {
      method: 'POST',
      headers: jsonHeaders(viewerLogin.csrf, viewerLogin.jar.header()),
      body: JSON.stringify({ name: 'Blocked', role: 'Notes', humanOwner: 'Viewer', botSlug: null }),
    })
    assert.equal(viewerSeat.status, 403)

    const editorSeat = await app.request(`/api/teams/${team.id}/seats`, {
      method: 'POST',
      headers: jsonHeaders(editor.csrf, editor.jar.header()),
      body: JSON.stringify({ name: 'Support', role: 'Follow-ups', humanOwner: 'Ada', botSlug: 'research' }),
    })
    assert.equal(editorSeat.status, 201)
    const seat = (await readJson(editorSeat)).seat as { id: string }

    const editorInvite = await app.request(`/api/teams/${team.id}/invites`, {
      method: 'POST',
      headers: jsonHeaders(editor.csrf, editor.jar.header()),
      body: JSON.stringify({ role: 'viewer' }),
    })
    assert.equal(editorInvite.status, 403)

    const renamed = await app.request(`/api/teams/${team.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
      body: JSON.stringify({ name: 'Alicante crew' }),
    })
    assert.equal(renamed.status, 200)

    const removed = await app.request(`/api/teams/${team.id}/seats/${seat.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(owner.csrf, owner.jar.header()),
    })
    assert.equal(removed.status, 200)
    assert.ok(editorToken)
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
  const { CookieJar, sessionOf } = await import('./helpers.ts')
  const jar = new CookieJar()
  const session = await sessionOf(app, jar)
  return { csrf: session.csrf, cookie: jar.header() }
}
