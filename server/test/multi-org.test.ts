import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { serializeSeat, type OrgBundle, type SeatDocument } from '../src/org-files.ts'
import { createOrgFiles, readOrgDir, startTemplateServer } from '../src/template-server.ts'

test('hiring into a second org writes only that org folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-multi-org-'))
  const first = createOrgFiles(dir, 'Alpha Co', 'Ada')
  const second = createOrgFiles(dir, 'Beta Co', 'Bea')
  assert.equal(first.ok && second.ok, true)
  if (!first.ok || !second.ok) return
  const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
  try {
    const before = readFileSync(join(dir, first.slug, 'org.md'), 'utf8')
    const loaded = (await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/${second.slug}`)).json()) as OrgBundle
    const seat = hired('reminder', 'Payment Reminder Bot', 'you')
    const saved = await fetch(`http://127.0.0.1:${started.port}/api/orgs/${second.slug}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        org: loaded.org,
        seats: [...loaded.seats, seat],
        work: loaded.work,
        activityAppend: [{
          id: 'hire-reminder-1',
          orgId: second.slug,
          type: 'hire',
          actorSeatId: 'you',
          actorType: 'human',
          timestamp: '2026-10-16T19:00:00.000Z',
          summary: 'Hired Payment Reminder Bot',
          subjectSeatId: 'reminder',
        }],
      }),
    })
    assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()))
    const seatPath = join(dir, second.slug, 'seats', 'reminder.md')
    assert.equal(existsSync(seatPath), true)
    assert.match(readFileSync(seatPath, 'utf8'), /title: Payment Reminder Bot/)
    assert.equal(existsSync(join(dir, first.slug, 'seats', 'reminder.md')), false)
    assert.equal(readFileSync(join(dir, first.slug, 'org.md'), 'utf8'), before)
    assert.equal(existsSync(join(dir, first.slug, 'log')), false)
    const beta = readOrgDir(join(dir, second.slug), second.slug)
    assert.equal(beta.ok, true)
    if (!beta.ok) return
    assert.equal(beta.bundle.org.seats.find((item) => item.slug === 'reminder')?.reportsTo, 'you')
    assert.equal(beta.bundle.seats.find((item) => item.slug === 'reminder')?.kind, 'bot')
    assert.equal(beta.bundle.activity.some((event) => event.type === 'hire' && event.subjectSeatId === 'reminder'), true)
    assert.ok(readdirSync(join(dir, second.slug, 'log')).some((name) => name.endsWith('.md')))
    assert.equal(existsSync(join(dir, second.slug, 'org.json')), false)
    assert.equal(existsSync(join(dir, second.slug, 'workchart.json')), false)
    assert.equal(existsSync(join(dir, second.slug, 'activity.jsonl')), false)
    const alpha = readOrgDir(join(dir, first.slug), first.slug)
    assert.equal(alpha.ok, true)
    if (alpha.ok) assert.deepEqual(alpha.bundle.seats.map((item) => item.slug), ['you'])
  } finally {
    await started.close()
  }
})

function hired(slug: string, title: string, reportsTo: string): SeatDocument {
  const seat: SeatDocument = {
    slug,
    title,
    department: 'general',
    reportsTo,
    addToGrokBotUrl: '',
    status: 'active',
    kind: 'bot',
    role: title,
    personId: '',
    hiredAt: '2026-10-16T19:00:00.000Z',
    retiredAt: '',
    directoryId: 'collections-bot',
    owns: ['Send the reminder'],
    may: ['Read the invoice'],
    mustAskBefore: ['Waive a fee'],
    doneWhen: ['The note is sent'],
    source: '',
  }
  seat.source = serializeSeat(seat)
  return seat
}
