import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { blockText, type Party } from '../src/bot-blocks.ts'
import { GROK_DATA_FILE } from '../src/connector-files.ts'
import { createOrgFiles, importFromConnector, readOrgDir } from '../src/template-server.ts'

const link = (id: string) => `grokbot://app/v1/agent?id=${id}`
const botParty = (name: string, id: string): Party => ({ kind: 'bot', name, id })
const person = (name: string): Party => ({ kind: 'person', name })

/** A block exactly as the app writes one into a bot's instructions. */
function block(copy: string, org: string, orgName: string, main: Party, also: Party[] = []): string {
  return blockText({ copyId: copy, orgId: org, orgName, orgsFolder: '/old/orgs', timeZone: 'Europe/Madrid', botName: 'x', seat: 'x', seatFile: '/old/orgs/x.md', main, also, team: [], skills: [], processFiles: [] })
}

function bot(id: string, name: string, blocks: string[], extra: Record<string, unknown> = {}) {
  return { id, name, grokBotUrl: link(id), description: [`${name} works.`, ...blocks].join('\n\n'), routinesVisible: false, ...extra }
}

test('a bot new to this copy keeps the managers another copy gave it in an organization with the same name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-keeps-structure-'))
  try {
    const orgs = join(dir, 'orgs')
    mkdirSync(orgs)
    writeFileSync(join(orgs, 'project.json'), '{ "id": "k3f9" }\n')
    const made = createOrgFiles(orgs, 'BotsEverywhere', 'You')
    assert.ok(made.ok)
    const old = (main: Party, also: Party[] = []) => block('acn8', 'org-old', 'BotsEverywhere', main, also)
    const grok = botParty('Grok Bot', 'g')
    writeFileSync(join(orgs, GROK_DATA_FILE), JSON.stringify({
      dumpedAt: '2026-11-02T16:26:21+01:00',
      copy: 'k3f9',
      skills: [],
      self: { id: 'c1', name: 'Connector - BotsEverywhere (k3f9)', grokBotUrl: link('c1') },
      bots: [
        bot('g', 'Grok Bot', [old(person('Miguel'))]),
        bot('b', 'Brand', [old(grok)]),
        // The block names the manager by its old name; its id finds the bot as Grok Bot calls it now.
        bot('d', 'Demo', [old(botParty('Old Brand Name', 'b'))], { reportsTo: 'Grok Bot' }),
        bot('s', 'Security', [old(botParty('Inner Loop', 'i'), [botParty('Outer Loop', 'o')])], { reportsTo: 'Grok Bot' }),
        bot('i', 'Inner Loop', [old(grok)], { reportsTo: 'Grok Bot' }),
        bot('o', 'Outer Loop', [old(grok)], { reportsTo: 'Grok Bot' }),
        bot('r', 'Research', [old(grok, [person('Miguel')])]),
        // A block for an organization with another name says nothing about this one.
        bot('t', 'Tester', [block('acn8', 'org-x', 'Testing new org', botParty('Inner Loop', 'i'))], { reportsTo: 'Grok Bot' }),
        // This copy's own block for this organization still comes first.
        bot('p', 'Pinned', [block('k3f9', made.slug, 'BotsEverywhere', botParty('Security', 's')), old(grok)]),
        bot('l', 'Loose', []),
      ],
    }))
    const result = importFromConnector(orgs, join(orgs, made.slug), made.slug)
    assert.ok(!('status' in result), JSON.stringify(result))
    const read = readOrgDir(join(orgs, made.slug), made.slug)
    assert.ok(read.ok)
    if (!read.ok) return
    const seat = (slug: string) => read.bundle.seats.find((item) => item.slug === slug)
    const managers = (slug: string) => [seat(slug)?.reportsTo, seat(slug)?.alsoReportsTo ?? []]
    assert.deepEqual(managers('grok-bot'), ['you', []], 'a person at the top becomes You')
    assert.deepEqual(managers('brand'), ['grok-bot', []])
    assert.deepEqual(managers('demo'), ['brand', []], 'the structure the owner built wins over the bot\'s own text')
    assert.deepEqual(managers('security'), ['inner-loop', ['outer-loop']], 'dotted lines come too')
    assert.deepEqual(managers('inner-loop'), ['grok-bot', []])
    assert.deepEqual(managers('research'), ['grok-bot', ['you']], 'a person on a dotted line becomes You')
    assert.deepEqual(managers('tester'), ['grok-bot', []], 'another organization\'s block is ignored')
    assert.deepEqual(managers('pinned'), ['security', []], 'this copy\'s own block comes first')
    assert.deepEqual(managers('loose'), ['you', []], 'no block and no manager in its text: under You')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
