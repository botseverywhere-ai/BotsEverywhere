import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { listCompanies } from '../../src/data/mock-company-index.ts'

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const hex = /#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})(?![0-9A-Fa-f])/g
const styleProp = /\bstyle\s*=\s*\{/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

test('components do not set a style prop', () => {
  const hits: string[] = []
  for (const file of walk(src)) {
    if (!file.endsWith('.tsx')) continue
    const text = readFileSync(file, 'utf8')
    if (styleProp.test(text)) hits.push(path.relative(root, file))
  }
  assert.deepEqual(hits, [])
})

test('raw hex colors stay in src/styles/tokens.css', () => {
  const hits: string[] = []
  for (const file of walk(src)) {
    if (!file.endsWith('.tsx') && !file.endsWith('.css')) continue
    if (file.endsWith(`${path.sep}src${path.sep}styles${path.sep}tokens.css`) || file.endsWith('/styles/tokens.css')) continue
    const text = readFileSync(file, 'utf8')
    const found = text.match(hex)
    if (found) hits.push(`${path.relative(root, file)}: ${found.join(' ')}`)
  }
  assert.deepEqual(hits, [])
})

test('the 10 realistic sample companies are on disk', () => {
  const samples = listCompanies().filter((company) => !company.org.ownerOrg)
  assert.equal(samples.length, 10)
  for (const company of samples) {
    const org = path.join(root, 'samples', company.org.id, 'org.json')
    assert.equal(statSync(org).isFile(), true, company.org.id)
  }
})
