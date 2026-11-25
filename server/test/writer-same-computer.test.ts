import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createOrgFiles, startTemplateServer } from '../src/template-server.ts'

type Answer = { status: number; text: string }

/** One raw request, so a test can send the headers a browser sets by itself: Origin, Sec-Fetch-Site, and Host. */
function ask(port: number, method: string, path: string, headers: Record<string, string> = {}, body = ''): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function writer() {
  const dir = mkdtempSync(join(tmpdir(), 'be-same-computer-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  const started = await startTemplateServer({ port: 0, orgsDir: orgs, host: '127.0.0.1' })
  return {
    orgs,
    port: started.port,
    done: async () => {
      await started.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

async function orgCount(port: number): Promise<number> {
  const listed = await ask(port, 'GET', '/api/orgs')
  return (JSON.parse(listed.text) as { orgs: unknown[] }).orgs.length
}

const newOrg = (name: string) => JSON.stringify({ name, owner: 'Ada' })
// What a form or a no-cors request on another site sends: that site's Origin and a plain content type.
const ANOTHER_SITE = { origin: 'https://evil.example', 'content-type': 'text/plain' }

test('a page on another site cannot create an organization', async () => {
  const w = await writer()
  try {
    assert.equal((await ask(w.port, 'POST', '/api/orgs', ANOTHER_SITE, newOrg('Desk'))).status, 403)
    // A sandboxed frame, or a file opened from disk, sends the Origin "null".
    assert.equal((await ask(w.port, 'POST', '/api/orgs', { origin: 'null' }, newOrg('Desk'))).status, 403)
    assert.equal(await orgCount(w.port), 0, 'nothing was written')
  } finally {
    await w.done()
  }
})

test('every route that changes something refuses a page on another site', async () => {
  const w = await writer()
  try {
    const made = createOrgFiles(w.orgs, 'Desk', 'Ada')
    assert.equal(made.ok, true)
    if (!made.ok) return
    const org = `/api/orgs/${made.slug}`
    const routes: [string, string][] = [
      ['POST', '/api/orgs'],
      ['POST', '/api/orgs/from-template'],
      ['PUT', '/api/template'],
      ['PUT', org],
      ['DELETE', org],
      ['PUT', `${org}/profile`],
      ['POST', `${org}/seats`],
      ['POST', `${org}/seats/existing`],
      ['PUT', `${org}/seats/you`],
      ['DELETE', `${org}/seats/you`],
      ['PUT', `${org}/seats/you/manager`],
      ['PUT', `${org}/seats/you/profile`],
      ['POST', `${org}/processes-file`],
      ['DELETE', `${org}/processes/intake`],
      ['POST', `${org}/bots-file`],
      ['POST', `${org}/bots-file/preview`],
      ['POST', `${org}/org-file`],
      ['POST', `${org}/sync/preview`],
      ['POST', `${org}/sync/apply`],
      ['POST', `${org}/activity`],
      ['POST', `${org}/import`],
    ]
    const open: string[] = []
    for (const [method, path] of routes) {
      const answer = await ask(w.port, method, path, ANOTHER_SITE, '{}')
      if (answer.status !== 403) open.push(`${method} ${path.replace(made.slug, '<org>')} answered ${answer.status}`)
    }
    assert.deepEqual(open, [])
    assert.equal(await orgCount(w.port), 1, 'the organization is still there, and no other was made')
  } finally {
    await w.done()
  }
})

test('a request the browser marks as coming from another site is refused even when it carries no Origin', async () => {
  const w = await writer()
  try {
    assert.equal((await ask(w.port, 'POST', '/api/orgs', { 'sec-fetch-site': 'cross-site' }, newOrg('Desk'))).status, 403)
    assert.equal(await orgCount(w.port), 0, 'nothing was written')
  } finally {
    await w.done()
  }
})

test("this computer's own page, and a tool with no browser, still change things", async () => {
  const w = await writer()
  try {
    const json = { 'content-type': 'application/json' }
    const senders: [string, Record<string, string>][] = [
      ['the page at 127.0.0.1', { ...json, origin: 'http://127.0.0.1:5199', 'sec-fetch-site': 'same-origin' }],
      ['the page at localhost', { ...json, origin: 'http://localhost:5199', 'sec-fetch-site': 'same-origin' }],
      ['the page when the site took another port', { ...json, origin: 'http://127.0.0.1:5200', 'sec-fetch-site': 'same-origin' }],
      ['a script or a test, which sends no Origin', json],
    ]
    for (const [who, headers] of senders) {
      assert.equal((await ask(w.port, 'POST', '/api/orgs', headers, newOrg(who))).status, 201, who)
    }
    assert.equal(await orgCount(w.port), 4)
  } finally {
    await w.done()
  }
})

test("a request with no body and no content type from this computer's page reaches its route", async () => {
  const w = await writer()
  try {
    const made = createOrgFiles(w.orgs, 'Desk', 'Ada')
    assert.equal(made.ok, true)
    if (!made.ok) return
    // Import from the Connector is sent bare. With no Connector reading yet, the route itself answers 404.
    const bare = await ask(w.port, 'POST', `/api/orgs/${made.slug}/connector-import`, { origin: 'http://127.0.0.1:5199', 'sec-fetch-site': 'same-origin' })
    assert.equal(bare.status, 404, bare.text)
  } finally {
    await w.done()
  }
})

test('a request addressed to another name is refused, reading included', async () => {
  const w = await writer()
  try {
    const made = createOrgFiles(w.orgs, 'Desk', 'Ada')
    assert.equal(made.ok, true)
    if (!made.ok) return
    // A name another site points at this computer still arrives with that name in Host.
    for (const host of ['evil.example', `evil.example:${w.port}`, `127.0.0.1.evil.example:${w.port}`, `localhost.evil.example:${w.port}`]) {
      const read = await ask(w.port, 'GET', '/api/orgs', { host })
      assert.equal(read.status, 403, `GET as ${host}`)
      assert.equal(read.text.includes(made.slug), false, `no organization is named to ${host}`)
      assert.equal((await ask(w.port, 'POST', '/api/orgs', { host, 'content-type': 'application/json' }, newOrg('Other'))).status, 403, `POST as ${host}`)
    }
    assert.equal(await orgCount(w.port), 1, 'nothing was written')
  } finally {
    await w.done()
  }
})

test('a request addressed to this computer by any of its names is answered', async () => {
  const w = await writer()
  try {
    for (const host of [`127.0.0.1:${w.port}`, `localhost:${w.port}`, `LOCALHOST:${w.port}`, `[::1]:${w.port}`, '127.0.0.1', 'localhost']) {
      assert.equal((await ask(w.port, 'GET', '/api/orgs', { host })).status, 200, host)
    }
  } finally {
    await w.done()
  }
})
