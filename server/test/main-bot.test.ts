import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readMainBot, readRemoveCopies, readSyncMinutes, writeMainBot, writeRemoveCopy, writeSyncMinutes } from '../src/project.ts'

test('the main bot is saved by id and survives interval and remove-copy writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'be-main-bot-'))
  try {
    assert.equal(readMainBot(dir), '')
    assert.deepEqual(writeMainBot(dir, '19d8f3f9'), { ok: true })
    assert.ok(writeSyncMinutes(dir, 30).ok)
    assert.ok(writeRemoveCopy(dir, 'zz99').ok)
    assert.equal(readMainBot(dir), '19d8f3f9')
    assert.equal(readSyncMinutes(dir), 30, 'saving the main bot keeps the interval')
    assert.deepEqual(readRemoveCopies(dir), ['zz99'])
    assert.equal(writeMainBot(dir, '').ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
