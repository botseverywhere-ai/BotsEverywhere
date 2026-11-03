import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sha256 } from '../src/crypto.ts'
import { openDatabase } from '../src/db.ts'
import { ACTIVITY, seedBotseverywhere, SEEDED_SEATS } from '../src/seed-botseverywhere.ts'
import { CookieJar, createTestApp, readJson, sessionOf } from './helpers.ts'

describe('organization goals and the Bot Company X seed', () => {
  it('computes progress from milestones and rejects a team view token', async () => {
    const { app } = createTestApp()
    const anon = await anonymous(app)
    const created = await app.request('/api/organizations', {
      method: 'POST',
      headers: jsonHeaders(anon.csrf, anon.cookie),
      body: JSON.stringify({ name: 'North office' }),
    })
    const ownerToken = tokenFrom(String((await readJson(created)).ownerUrl), 'owner/')
    const goal = await app.request('/api/owner/goals', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ title: 'Version 2.0 release', dueOn: '2026-11-30' }),
    })
    assert.equal(goal.status, 201)
    const goalId = (await readJson(goal)).goal as { id: string }
    const added = await app.request(`/api/owner/goals/${goalId.id}/milestones`, {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ title: 'owner link' }),
    })
    assert.equal(added.status, 201)
    const withMilestone = (await readJson(added)).goals as { progress: { done: number; total: number }; milestones: { id: string; done: boolean; dueOn: string | null }[] }[]
    assert.deepEqual(withMilestone[0]?.progress, { done: 0, total: 1 })
    assert.equal(withMilestone[0]?.milestones[0]?.dueOn, null)

    const milestoneId = withMilestone[0]?.milestones[0]?.id
    const toggled = await app.request(`/api/owner/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ done: true, dueOn: '2026-10-15' }),
    })
    assert.equal(toggled.status, 200)
    const progress = ((await readJson(toggled)).goals as { progress: { done: number; total: number }; milestones: { done: boolean; dueOn: string | null }[] }[])[0]
    assert.deepEqual(progress?.progress, { done: 1, total: 1 })
    assert.equal(progress?.milestones[0]?.done, true)
    assert.equal(progress?.milestones[0]?.dueOn, '2026-10-15')

    const team = await app.request('/api/teams', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': ownerToken },
      body: JSON.stringify({ name: 'Implementation' }),
    })
    const viewToken = tokenFrom(((await readJson(team)).links as { viewUrl: string }).viewUrl, 'view-')
    const denied = await app.request('/api/owner/goals', {
      method: 'POST',
      headers: { ...jsonHeaders(anon.csrf, anon.cookie), 'x-owner-token': viewToken },
      body: JSON.stringify({ title: 'Nope', dueOn: '2026-11-07' }),
    })
    assert.equal(denied.status, 404)
  })

  it('seeds Bot Company X from its seat cards and made-up release log, without storing the owner token', () => {
    const { sqlite } = createTestApp()
    const db = openDatabase(sqlite)
    const seeded = seedBotseverywhere(db, { origin: 'http://127.0.0.1:5199', now: 1 })
    assert.equal(seeded.created, true)
    if (!seeded.created) return
    assert.equal(Buffer.from(seeded.ownerToken, 'base64url').length, 32)

    const stored = JSON.stringify(sqlite.prepare('SELECT id, name, owner_token_hash FROM organizations').all())
    assert.equal(stored.includes(seeded.ownerToken), false)
    const row = sqlite.prepare('SELECT owner_token_hash FROM organizations WHERE id = ?').get('org-bot-company-x') as { owner_token_hash: string }
    assert.equal(row.owner_token_hash, sha256(seeded.ownerToken))

    const seats = sqlite.prepare('SELECT id, name, kind, reports_to, owns, may, must_ask_before, done_when FROM seats WHERE team_id = ? ORDER BY sort_order').all('team-bot-company-x') as {
      id: string
      name: string
      kind: string
      reports_to: string | null
      owns: string
      may: string
      must_ask_before: string
      done_when: string
    }[]
    assert.deepEqual(seats.map((seat) => seat.name), SEEDED_SEATS.map((seat) => seat.name))
    assert.equal(seats[0]?.kind, 'human')
    assert.equal(seats[1]?.name, 'Grok Bot')
    assert.equal(seats[1]?.reports_to, 'seat-sam')
    assert.equal(seats.filter((seat) => seat.reports_to === 'seat-grok').length, 10)

    const review = seats.find((seat) => seat.name === 'Review Bot')
    assert.equal(review?.owns, 'the first-pass review of every pull request: tests, the diff against the project rules, and a plain-words review draft.')
    const social = seats.find((seat) => seat.name === 'Issue Bot')
    assert.equal(social?.done_when, 'every new issue has labels proposed and a draft reply waiting for the maintainer.')
    const bench = seats.find((seat) => seat.name === 'Benchmark Bot')
    assert.match(bench?.may ?? '', /run the suite on branches and previews/)
    const grok = seats.find((seat) => seat.name === 'Grok Bot')
    const grokSource = JSON.parse((sqlite.prepare('SELECT card_provenance FROM seats WHERE id = ?').get('seat-grok') as { card_provenance: string }).card_provenance) as { mustAskBefore: string }
    assert.equal(grokSource.mustAskBefore, 'handbook v1')
    assert.match(grok?.must_ask_before ?? '', /from handbook v1/)
    for (const seat of seats.filter((item) => item.kind === 'bot')) {
      assert.notEqual(seat.owns.trim(), '')
      assert.notEqual(seat.may.trim(), '')
      assert.notEqual(seat.must_ask_before.trim(), '')
      assert.notEqual(seat.done_when.trim(), '')
    }

    const milestones = sqlite.prepare('SELECT title, done, due_on FROM milestones ORDER BY sort_order').all() as { title: string; done: number; due_on: string | null }[]
    assert.deepEqual(milestones.map((item) => item.title), [
      'release plan approved',
      'open pull requests reviewed',
      'benchmarks green on the candidate',
      'release notes approved',
      'version 2.0 tagged',
    ])
    assert.deepEqual(milestones.map((item) => item.done), [0, 0, 0, 0, 0])

    const activity = sqlite.prepare('SELECT at, summary, commit_sha FROM activity_log ORDER BY at').all() as { at: string; summary: string; commit_sha: string }[]
    assert.deepEqual(activity.map((item) => item.summary), ACTIVITY.map((item) => item.summary))
    assert.equal(activity[0]?.at, '2026-10-01T09:12:00+00:00')

    const steps = sqlite.prepare('SELECT name, executor_seat_id FROM steps ORDER BY sort_order').all() as { name: string; executor_seat_id: string }[]
    assert.deepEqual(steps.map((step) => step.name), ['Write the release plan', 'Review the pull requests', 'Run the agent benchmarks', 'Draft the release notes'])
    const back = sqlite.prepare('SELECT from_step_id, to_step_id FROM handoffs WHERE id = ?').get('hand-bench-review') as { from_step_id: string; to_step_id: string }
    assert.deepEqual(back, { from_step_id: 'step-bench', to_step_id: 'step-review' })
    const checkpoint = sqlite.prepare('SELECT rule, approver_seat_id, required FROM checkpoints').get() as { rule: string; approver_seat_id: string; required: number }
    assert.equal(checkpoint.rule, 'The maintainer approves every merge and every release.')
    assert.equal(checkpoint.approver_seat_id, 'seat-sam')
    assert.equal(checkpoint.required, 1)

    assert.equal(seedBotseverywhere(db, { origin: 'http://127.0.0.1:5199' }).created, false)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM organizations').get().n, 1)
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

function tokenFrom(url: string, prefix: string): string {
  const hash = new URL(url).hash.replace(/^#/, '')
  assert.ok(hash.startsWith(prefix), hash)
  return hash.slice(prefix.length)
}
