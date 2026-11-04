import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { MockSeed } from '../../src/data/mock-companies.ts'
import { validateMockCompanies } from '../../src/data/validate-mock-companies.ts'
import { missingCardFields } from '../../src/preview/hire.ts'

const seed = JSON.parse(readFileSync(new URL('../../src/data/mock-companies.json', import.meta.url), 'utf8')) as MockSeed

describe('mock companies', () => {
  it('passes the section 5 contract', () => {
    assert.deepEqual(validateMockCompanies(seed), [])
  })

  it('lists 10 samples and the owner org', () => {
    assert.equal(seed.companies.length, 11)
    const owner = seed.companies.find((company) => company.org.ownerOrg)
    assert.equal(owner?.org.name, 'Bot Company X')
    assert.equal(owner?.org.mock, false)
    const samples = seed.companies.filter((company) => company.org.mock)
    assert.equal(samples.length, 10)
    const finance = samples.find((company) => company.org.id === 'meridian-ledger')
    assert.ok(finance?.workstreams.some((stream) => stream.outcome.includes('paid')))
  })
})

describe('hire card gate', () => {
  const full = { owns: 'Match invoices', may: 'Read the PO', mustAskBefore: 'Sending mail', doneWhen: 'A human can approve' }

  it('names each empty field on its own', () => {
    for (const field of ['owns', 'may', 'mustAskBefore', 'doneWhen'] as const) {
      const card = { ...full, [field]: '   ' }
      assert.deepEqual(missingCardFields(card).length, 1)
      assert.notEqual(missingCardFields(card)[0].length, 0)
    }
  })

  it('allows a hire only when every field has text', () => {
    assert.deepEqual(missingCardFields(full), [])
  })
})
