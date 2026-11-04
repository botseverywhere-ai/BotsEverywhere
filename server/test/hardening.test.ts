import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHash } from '../../src/routing.ts'

describe('hash routing', () => {
  it('routes a malformed hash to the invalid link instead of throwing', () => {
    assert.equal(parseHash('#%').view, 'invalid')
    assert.equal(parseHash('#%E0%A4%A').view, 'invalid')
    assert.equal(parseHash('#home').view, 'home')
    assert.equal(parseHash('').view, 'landing')
    const opened = parseHash('#o/your-company')
    assert.equal(opened.view, 'opened')
    if (opened.view === 'opened') {
      assert.equal(opened.slug, 'your-company')
      assert.equal(opened.chart, 'work')
    }
  })

  it('knows only the routes the app has: no sign-in, teams, or share links', () => {
    for (const hash of ['#signin', '#teams', '#intake', '#organization', '#owner/0123456789abcdef0123', '#invite-abc', '#edit-0123456789abcdef0123', '#view-0123456789abcdef0123']) {
      assert.equal(parseHash(hash).view, 'home', hash)
    }
  })
})
