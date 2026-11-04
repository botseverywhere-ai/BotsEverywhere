import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CONNECTOR_FILE } from '../src/project.ts'
import { createOrgFiles, grokAccount } from '../src/template-server.ts'
import { accountRows } from '../../src/components/sync-copy.ts'

function seat(root: string, slug: string, title: string, extra: string) {
  writeFileSync(join(root, 'seats', `${slug}.md`), `---\ntitle: ${title}\ndepartment: general\nreportsTo: you\naddToGrokBotUrl: ""\nkind: bot\nrole: ${title}\npersonId: ""\nhiredAt: ""\ndirectoryId: ""\n${extra}---\n\n## Owns\nRows\n\n## May\nRead\n\n## Needs approval\nPaging\n\n## Done when\nListed\n`, 'utf8')
}

test('In Grok Bot counts every bot in the account once, whatever its organization, plus the Connector', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-account-'))
  const orgs = join(dir, 'orgs')
  mkdirSync(orgs)
  try {
    const desk = createOrgFiles(orgs, 'Desk', 'Ada')
    const ledger = createOrgFiles(orgs, 'Ledger', 'Ada')
    if (!desk.ok || !ledger.ok) throw new Error('no org')
    assert.equal(grokAccount(orgs, desk.slug), null, 'no Connector report yet')
    seat(join(orgs, desk.slug), 'invoice-bot', 'Invoice Bot', 'status: active\ngrokBotUrl: "grokbot://invoice"\n')
    seat(join(orgs, ledger.slug), 'invoice-bot', 'Invoice Bot', 'status: active\ngrokBotUrl: "grokbot://invoice"\n')
    seat(join(orgs, desk.slug), 'old-bot', 'Old Bot', 'status: retired\nretiredAt: "2026-10-20T10:00:00.000Z"\ngrokBotUrl: "grokbot://old"\n')
    const snap = (slug: string, bots: object[]) => {
      mkdirSync(join(orgs, slug, 'grok'), { recursive: true })
      writeFileSync(join(orgs, slug, 'grok', 'snapshot.json'), JSON.stringify({ syncedAt: '2026-10-20T18:00:00Z', bots, processes: [] }))
    }
    snap(desk.slug, [{ name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice' }, { name: 'Old Bot', grokBotUrl: 'grokbot://old' }])
    snap(ledger.slug, [{ name: 'Invoice Bot', grokBotUrl: 'grokbot://invoice' }])
    writeFileSync(join(orgs, CONNECTOR_FILE), JSON.stringify({ syncedAt: '2026-10-20T18:00:00Z', unassigned: [{ name: 'Loose Bot', grokBotUrl: 'grokbot://loose' }] }))

    const account = grokAccount(orgs, desk.slug)!
    assert.equal(account.total, 4, 'Invoice Bot once though it is in two orgs, Old Bot, Loose Bot, and the Connector')
    assert.equal(account.complete, true)
    const by = Object.fromEntries(account.bots.map((bot) => [bot.name.startsWith('Connector') ? 'Connector' : bot.name, bot]))
    assert.deepEqual([by['Invoice Bot']!.where, by['Invoice Bot']!.orgs.sort(), by['Invoice Bot']!.seat], ['active', ['Desk', 'Ledger'], 'invoice-bot'])
    assert.equal(by['Old Bot']!.where, 'retired')
    assert.equal(by['Loose Bot']!.where, 'none')
    assert.equal(by['Connector']!.where, 'connector')
    const rows = accountRows(account)
    assert.deepEqual(rows.filter((row) => row.pickable).map((row) => row.name), ['Invoice Bot'], 'only a bot on this chart can be found on it')
    assert.match(rows.find((row) => row.name === 'Old Bot')!.meta, /^Retired in Desk, still running in Grok Bot$/)

    writeFileSync(join(orgs, ledger.slug, 'grok', 'snapshot.json'), '{broken', 'utf8')
    assert.equal(grokAccount(orgs, desk.slug)!.complete, false, 'an unreadable snapshot is reported, never a crash')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Overview and the chart legend show the account total for In Grok Bot', () => {
  const overview = readFileSync(new URL('../../src/pages/CompanyOverview.tsx', import.meta.url), 'utf8')
  const chart = readFileSync(new URL('../../src/components/OrgChart.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.ok(overview.includes("countBox('In Grok Bot', account ? account.total : counts.inGrok, 'in-grok')"))
  assert.ok(chart.includes("legendItem('in-grok', 'swatch-grok', 'In Grok Bot', account ? account.total : counts.inGrok)"))
  assert.match(workspace, /account=\{editable \? sync\?\.project\?\.account \?\? null : null\}/)
})
