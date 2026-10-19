import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  bundleFromState,
  isGrokBotUrl,
  parseSeatMarkdown,
  serializeSeat,
  validateBundle,
  type OrgBundle,
  type SeatDocument,
} from '../src/org-files.ts'
import { parseOrgMarkdown } from '../src/org-markdown.ts'
import { unzipStore, zipStore } from '../src/zip-store.ts'
import { appendActivity, readOrgDir, seatFile, startTemplateServer, writeOrgDir } from '../src/template-server.ts'

function seat(patch: Partial<SeatDocument> = {}): SeatDocument {
  const draft = {
    slug: 'you',
    title: 'You',
    department: 'general',
    reportsTo: '',
    addToGrokBotUrl: '',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    status: 'active' as const,
    kind: 'human' as const,
    role: 'Founder',
    personId: 'person-you',
    owns: ['The approve'],
    may: ['Edit the org'],
    mustAskBefore: ['Shipping'],
    doneWhen: ['The files are committed'],
    ...patch,
  }
  return { ...draft, source: serializeSeat(draft) }
}

function bundle(seats: SeatDocument[], reportsTo?: (string | null)[]): OrgBundle {
  return {
    id: 'org',
    org: {
      company: { name: 'Test Co' },
      departments: [{ id: 'general', name: 'General' }],
      people: [{ id: 'person-you', name: 'You' }],
      seats: seats.map((item, index) => ({ slug: item.slug, reportsTo: reportsTo ? reportsTo[index]! : item.reportsTo || null })),
    },
    seats,
    work: {
      triggers: [{ id: 't', source: 'management', label: 'Start', example: 'Go' }],
      workstreams: [{ id: 'w', triggerId: 't', outcome: 'Done', ownerSeatId: seats[0]!.slug, kind: 'main', stepIds: ['s'] }],
      steps: [{ id: 's', workstreamId: 'w', name: 'Step', level: 2, executorSeatId: seats[0]!.slug }],
      handoffs: [],
      checkpoints: [],
    },
    activity: [],
  }
}

describe('addToGrokBotUrl', () => {
  it('accepts an empty link and an https://x.ai/bot/ id', () => {
    assert.equal(isGrokBotUrl(''), true)
    assert.equal(isGrokBotUrl('https://x.ai/bot/abc_123'), true)
    assert.equal(parseSeatMarkdown('you', serializeSeat(seat())).ok, true)
    assert.equal(parseSeatMarkdown('you', serializeSeat(seat({ addToGrokBotUrl: 'https://x.ai/bot/abc' }))).ok, true)
  })

  it('keeps a seat description on the chart blurb field', () => {
    const parsed = parseSeatMarkdown('you', serializeSeat(seat({ description: 'Keeps the week moving.' })))
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.seat.description, 'Keeps the week moving.')
    const plain = parseSeatMarkdown('you', serializeSeat(seat()))
    assert.equal(plain.ok, true)
    if (plain.ok) assert.equal(plain.seat.description, undefined)
  })

  it('rejects any other link', () => {
    for (const addToGrokBotUrl of ['https://example.com/bot/abc', 'http://x.ai/bot/abc', 'https://x.ai/bot/', 'https://x.ai/bot/abc/extra']) {
      const parsed = parseSeatMarkdown('you', serializeSeat(seat({ addToGrokBotUrl })))
      assert.equal(parsed.ok, false)
      if (!parsed.ok) assert.match(parsed.errors.join('\n'), /addToGrokBotUrl/)
    }
  })
})

describe('org files', () => {
  it('reports a tree that disagrees with the markdown', () => {
    const errors = validateBundle(bundle([seat()], ['someone-else']))
    assert.ok(errors.some((error) => error.includes('reportsTo')))
  })

  it('keeps a seat file when a save omits it and retires the bot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-'))
    const you = seat()
    const extra = seat({ slug: 'research', title: 'Research', kind: 'bot', personId: '', reportsTo: 'you' })
    const first = writeOrgDir(dir, bundle([you, extra]))
    assert.deepEqual(first.errors, [])
    assert.ok(first.files.includes('seats/you.md'))
    assert.ok(first.files.includes('seats/research.md'))
    writeFileSync(join(dir, 'seats', 'stray.md'), 'nope\n')
    const blocked = writeOrgDir(dir, bundle([you]))
    assert.ok(blocked.errors.some((error) => error.includes('stray.md')))
    assert.equal(existsSync(join(dir, 'seats', 'stray.md')), true)
    assert.equal(existsSync(join(dir, 'seats', 'research.md')), true)
    rmSync(join(dir, 'seats', 'stray.md'))
    const second = writeOrgDir(dir, bundle([you]))
    assert.deepEqual(second.errors, [])
    assert.equal(existsSync(join(dir, 'seats', 'research.md')), true)
    const read = readOrgDir(dir, 'org')
    assert.equal(read.ok, true)
    if (read.ok) {
      const research = read.bundle.seats.find((item) => item.slug === 'research')
      assert.equal(research?.status, 'retired')
      assert.ok(research?.retiredAt)
    }
  })

  it('stores seats in slug order so a reload is not a change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-'))
    const you = seat()
    const research = seat({ slug: 'research', title: 'Research', kind: 'bot', personId: '', reportsTo: 'you', owns: ['Look things up'] })
    const zebra = seat({ slug: 'zebra', title: 'Zebra', kind: 'bot', personId: '', reportsTo: 'you', owns: ['Count stripes'] })
    assert.deepEqual(writeOrgDir(dir, bundle([you, zebra, research])).errors, [])
    const onDisk = parseOrgMarkdown(readFileSync(join(dir, 'org.md'), 'utf8'))
    assert.equal(onDisk.ok, true)
    if (!onDisk.ok) return
    assert.deepEqual(onDisk.org.seats.map((item) => item.slug), ['research', 'you', 'zebra'])
    const read = readOrgDir(dir, 'org')
    assert.equal(read.ok, true)
    if (!read.ok) return
    assert.deepEqual(read.bundle.seats.map((item) => item.slug), ['research', 'you', 'zebra'])
    assert.deepEqual(read.bundle.org.seats.map((item) => item.slug), ['research', 'you', 'zebra'])
    const reversed = bundleFromState('org', read.bundle.org, [...read.bundle.seats].reverse(), read.bundle.work, read.bundle.activity)
    assert.deepEqual(reversed.seats.map((item) => item.slug), read.bundle.seats.map((item) => item.slug))
    assert.deepEqual(reversed.org.seats.map((item) => item.slug), read.bundle.org.seats.map((item) => item.slug))
    const text = readFileSync(join(dir, 'org.md'), 'utf8')
    assert.deepEqual(writeOrgDir(dir, read.bundle).errors, [])
    assert.equal(readFileSync(join(dir, 'org.md'), 'utf8'), text)
  })

  it('keeps a hired bot and the hire line when the files just read are saved again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-'))
    const you = seat()
    const research = seat({ slug: 'research', title: 'Research', kind: 'bot', personId: '', reportsTo: 'you', owns: ['Look things up'] })
    assert.deepEqual(writeOrgDir(dir, bundle([you])).errors, [])
    assert.deepEqual(writeOrgDir(dir, bundle([you, research])).errors, [])
    const hire = appendActivity(dir, {
      id: 'hire-research',
      orgId: 'org',
      type: 'hire',
      actorSeatId: 'you',
      actorType: 'human',
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'Hired Research',
      subjectSeatId: 'research',
    })
    assert.deepEqual(hire.errors, [])
    const read = readOrgDir(dir, 'org')
    assert.equal(read.ok, true)
    if (!read.ok) return
    assert.deepEqual(writeOrgDir(dir, read.bundle).errors, [])
    const after = readOrgDir(dir, 'org')
    assert.equal(after.ok, true)
    if (!after.ok) return
    assert.equal(after.bundle.seats.find((item) => item.slug === 'research')?.status, 'active')
    assert.equal(after.bundle.activity.some((event) => event.type === 'hire' && event.subjectSeatId === 'research'), true)
    assert.equal(after.bundle.activity.some((event) => event.type === 'fire'), false)
  })

  it('refuses a seat path that leaves the seats folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-'))
    assert.equal(seatFile(dir, '../secret'), null)
    assert.equal(seatFile(dir, 'you/../../secret'), null)
    const safe = seatFile(dir, 'you')
    assert.ok(safe?.endsWith(`${join('seats', 'you.md')}`))
  })

  it('loads the shipped starter and the harbor sample', () => {
    const orgDir = fileURLToPath(new URL('../../orgs/your-company', import.meta.url))
    const harborDir = fileURLToPath(new URL('../../samples/harbor', import.meta.url))
    const org = readOrgDir(orgDir, 'org')
    const harbor = readOrgDir(harborDir, 'harbor')
    assert.equal(org.ok, true)
    assert.equal(harbor.ok, true)
    if (org.ok) assert.ok(org.bundle.seats.every((item) => item.addToGrokBotUrl === ''))
    if (harbor.ok) assert.ok(harbor.bundle.seats.every((item) => item.addToGrokBotUrl === ''))
  })

  it('includes every preview company as a read-only sample folder', () => {
    const seed = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/data/mock-companies.json', import.meta.url)), 'utf8')) as {
      companies: { org: { id: string }; seats: unknown[] }[]
    }
    const samples = fileURLToPath(new URL('../../samples', import.meta.url))
    for (const company of seed.companies) {
      const read = readOrgDir(join(samples, company.org.id), company.org.id)
      assert.equal(read.ok, true, company.org.id)
      if (read.ok) {
        assert.equal(read.bundle.seats.length, company.seats.length)
        assert.ok(read.bundle.seats.every((seat) => seat.addToGrokBotUrl === ''))
      }
    }
    assert.ok(readdirSync(samples).includes('harbor'))
  })
})

describe('dev host binding', () => {
  it('keeps Vite and the writer on 127.0.0.1', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    const devAll = readFileSync(join(root, 'scripts/dev-all.ts'), 'utf8')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    assert.doesNotMatch(vite, /0\.0\.0\.0/)
    assert.match(vite, /host: '127\.0\.0\.1'/)
    assert.doesNotMatch(devAll, /0\.0\.0\.0/)
    assert.match(devAll, /--host', '127\.0\.0\.1'/)
    for (const name of ['dev:web', 'preview'] as const) {
      assert.match(pkg.scripts[name] ?? '', /--host 127\.0\.0\.1/)
      assert.doesNotMatch(pkg.scripts[name] ?? '', /0\.0\.0\.0/)
    }
    assert.throws(() => {
      void startTemplateServer({ host: '0.0.0.0', port: 0 })
    }, /127\.0\.0\.1/)
  })
})

describe('template file API', () => {
  it('appends a fire line when a save omits an active bot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-api-'))
    const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
    const you = seat()
    const research = seat({ slug: 'research', title: 'Research', kind: 'bot', personId: '', reportsTo: 'you', owns: ['Look things up'] })
    try {
      const put = (payload: OrgBundle) => fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      assert.equal((await put(bundle([you, research]))).status, 200)
      assert.equal((await put(bundle([you]))).status, 200)
      const loaded = (await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`)).json()) as OrgBundle
      assert.equal(loaded.seats.find((item) => item.slug === 'research')?.status, 'retired')
      const fires = loaded.activity.filter((event) => event.type === 'fire' && event.subjectSeatId === 'research')
      assert.equal(fires.length, 1)
      assert.equal(fires[0]?.summary, 'Retired Research')
      assert.equal(existsSync(join(dir, 'your-company', 'seats', 'research.md')), true)
      assert.equal((await put(bundle([you]))).status, 200)
      const again = (await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`)).json()) as OrgBundle
      assert.equal(again.activity.filter((event) => event.type === 'fire').length, 1)
    } finally {
      await started.close()
    }
  })

  it('does not log an edit event when files are saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-api-'))
    const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
    const edit = {
      id: 'edit-1',
      orgId: 'your-company',
      type: 'edit' as const,
      actorSeatId: 'you',
      actorType: 'human' as const,
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'Saved org files',
    }
    const hire = {
      id: 'hire-1',
      orgId: 'your-company',
      type: 'hire' as const,
      actorSeatId: 'you',
      actorType: 'human' as const,
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'Hired Research',
      subjectSeatId: 'research',
    }
    try {
      const payload = bundle([seat()])
      const put = (events: object[]) => fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, activityAppend: events }),
      })
      assert.equal((await put([edit, { ...edit, id: 'edit-2' }])).status, 200)
      assert.equal((await put([hire])).status, 200)
      const body = (await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`)).json()) as OrgBundle
      assert.deepEqual(body.activity.map((event) => event.type), ['hire'])
      assert.equal(body.activity.some((event) => event.summary === 'Saved org files'), false)
    } finally {
      await started.close()
    }
  })


  it('rewrites activity orgId when importing into a different org', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-api-'))
    const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
    const payload = bundle([seat()])
    payload.id = 'elsewhere'
    payload.activity = [{
      id: 'edit-there',
      orgId: 'elsewhere',
      type: 'edit',
      actorSeatId: 'you',
      actorType: 'human',
      timestamp: '2026-01-01T00:00:00.000Z',
      summary: 'Saved org files',
    }]
    try {
      const imported = await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      assert.equal(imported.status, 200)
      const loaded = (await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`)).json()) as OrgBundle
      assert.equal(loaded.activity[0]?.orgId, 'your-company')
    } finally {
      await started.close()
    }
  })

  it('rejects a save that clears any required card section on an active bot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-api-'))
    const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
    const research = seat({ slug: 'research', title: 'Research', kind: 'bot', personId: '', reportsTo: 'you', owns: ['Look things up'] })
    const put = (bot: SeatDocument) => fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bundle([seat(), bot])),
    })
    try {
      assert.equal((await put(research)).status, 200)
      const before = readFileSync(join(dir, 'your-company', 'seats', 'research.md'), 'utf8')
      for (const [field, label] of [
        ['owns', 'Owns'],
        ['may', 'May'],
        ['mustAskBefore', 'Needs approval'],
        ['doneWhen', 'Done when'],
      ] as const) {
        const cleared = seat({ ...research, [field]: field === 'owns' ? ['   '] : [] })
        const saved = await put(cleared)
        assert.equal(saved.status, 422)
        const body = (await saved.json()) as { errors?: string[] }
        assert.equal(body.errors?.join('\n') ?? '', `research.md: ${label}: an active bot needs at least one line.`)
        assert.equal(readFileSync(join(dir, 'your-company', 'seats', 'research.md'), 'utf8'), before)
      }
      const retired = seat({ ...research, status: 'retired', owns: [] })
      assert.equal((await put(retired)).status, 200)
    } finally {
      await started.close()
    }
  })

  it('rejects an active bot with an empty Owns section', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-api-'))
    const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
    const research = seat({ slug: 'research', title: 'Research', kind: 'bot', personId: '', reportsTo: 'you', owns: [] })
    try {
      const imported = await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bundle([seat(), research])),
      })
      assert.equal(imported.status, 422)
      const body = (await imported.json()) as { errors?: string[] }
      assert.match(body.errors?.join('\n') ?? '', /research\.md: Owns: an active bot needs at least one line/)
    } finally {
      await started.close()
    }
  })

  it('imports a zip and rewrites its activity orgId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-org-api-'))
    const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
    const you = seat()
    const payload = bundle([you])
    const zip = zipStore([
      { name: 'exported/org.json', data: Buffer.from(JSON.stringify(payload.org)) },
      { name: 'exported/workchart.json', data: Buffer.from(JSON.stringify(payload.work)) },
      { name: 'exported/activity.jsonl', data: Buffer.from(`${JSON.stringify({
        id: 'edit-there',
        orgId: 'elsewhere',
        type: 'edit',
        actorSeatId: 'you',
        actorType: 'human',
        timestamp: '2026-01-01T00:00:00.000Z',
        summary: 'Saved org files',
      })}\n`) },
      { name: 'exported/seats/you.md', data: Buffer.from(you.source) },
    ])
    assert.equal(unzipStore(zip).some((entry) => entry.name === 'exported/org.json'), true)
    const stamped = zipStore([{ name: 'org.json', data: Buffer.from('{}') }], new Date(2026, 9, 15, 14, 30, 0))
    const dosDate = stamped.readUInt16LE(12)
    assert.equal((dosDate >> 9) + 1980, 2026)
    assert.equal((dosDate >> 5) & 0b1111, 10)
    assert.equal(dosDate & 0b11111, 15)
    assert.notEqual(dosDate, 0)
    try {
      const imported = await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: zip,
      })
      assert.equal(imported.status, 200, JSON.stringify(await imported.clone().json()))
      const loaded = (await (await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`)).json()) as OrgBundle
      assert.equal(loaded.seats[0]?.title, 'You')
      assert.equal(loaded.activity[0]?.orgId, 'your-company')
    } finally {
      await started.close()
    }
  })

  it('binds only to loopback and writes the org', async () => {
    assert.throws(() => {
      void startTemplateServer({ host: '0.0.0.0', port: 0 })
    }, /127\.0\.0\.1/)
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      assert.throws(() => {
        void startTemplateServer({ port: 0 })
      }, /dev-only/)
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }

    const dir = mkdtempSync(join(tmpdir(), 'be-org-api-'))
    const started = await startTemplateServer({ port: 0, orgsDir: dir, host: '127.0.0.1' })
    try {
      const session = await fetch(`http://127.0.0.1:${started.port}/api/session`)
      assert.equal(session.status, 200)
      const body = (await session.json()) as { authEnabled: boolean; user: null }
      assert.equal(body.authEnabled, false)
      assert.equal(body.user, null)

      const saved = await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bundle([seat()])),
      })
      assert.equal(saved.status, 200)
      const savedBody = (await saved.json()) as { files: string[]; savedAt: string }
      assert.ok(savedBody.files.includes('orgs/your-company/org.md'))
      assert.ok(savedBody.files.includes('orgs/your-company/seats/you.md'))
      assert.ok(savedBody.files.includes('orgs/your-company/work-chart.md'))
      assert.equal(existsSync(join(dir, 'your-company', 'org.json')), false)
      assert.equal(existsSync(join(dir, 'your-company', 'workchart.json')), false)
      assert.ok(savedBody.savedAt)
      const loaded = await fetch(`http://127.0.0.1:${started.port}/api/orgs/your-company`)
      assert.equal(loaded.status, 200)
      const payload = (await loaded.json()) as OrgBundle
      assert.equal(payload.seats[0]?.title, 'You')
    } finally {
      await started.close()
    }
  })
})
