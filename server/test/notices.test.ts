import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { RunLine } from '../src/run-log.ts'
import { MAX_NOTICES, createNoticeStore, newRunLines, runLinesNotice, snapshotNotice } from '../../src/live/notices.ts'

function line(index: number, status: RunLine['status'] = 'done', extra: Partial<RunLine> = {}): RunLine {
  return { date: '2026-10-18', time: '09:0' + index, bot: 'Invoice Bot', process: 'Invoice arrives', step: 'Draft', status, note: '', index, ...extra }
}

test('the store keeps notices until closed, newest last, capped, no repeats', () => {
  const store = createNoticeStore()
  assert.deepEqual(store.get(), [])
  const first = store.push({ kind: 'ok', message: 'Synced: 26 updated', link: { label: 'See it in Logs', href: '#/org/x/logs' } })
  store.push({ kind: 'ok', message: 'Seat moved' })
  assert.deepEqual(store.get().map((n) => n.message), ['Synced: 26 updated', 'Seat moved'])
  store.push({ kind: 'ok', message: 'Synced: 26 updated' })
  assert.deepEqual(store.get().map((n) => n.message), ['Seat moved', 'Synced: 26 updated'], 'a repeat moves to the end instead of stacking twice')
  store.dismiss(first)
  assert.equal(store.get().length, 2, 'the old id is gone; the repeat has its own id')
  for (let i = 0; i < MAX_NOTICES + 3; i += 1) store.push({ kind: 'ok', message: `n${i}` })
  assert.equal(store.get().length, MAX_NOTICES)
  assert.equal(store.get().at(-1)?.message, `n${MAX_NOTICES + 2}`)
})

test('the store tells subscribers and stops after unsubscribe', () => {
  const store = createNoticeStore()
  let calls = 0
  const off = store.subscribe(() => { calls += 1 })
  const id = store.push({ kind: 'bad', message: 'Not saved: x' })
  store.dismiss(id)
  off()
  store.push({ kind: 'ok', message: 'later' })
  assert.equal(calls, 2)
})

test('only run-log lines not seen before count as new', () => {
  assert.deepEqual(newRunLines([line(1)], [line(1), line(2)]), [line(2)])
  assert.deepEqual(newRunLines([line(1, 'running')], [line(1, 'done')]), [line(1, 'done')], 'a step that changes status is news')
  assert.deepEqual(newRunLines([line(1), line(2)], [line(2)]), [])
})

test('run-log notices name one line or count several, red when one failed', () => {
  assert.equal(runLinesNotice([]), null)
  assert.deepEqual(runLinesNotice([line(1)], '#/org/x/work-chart'), {
    kind: 'ok',
    message: 'Invoice Bot · Invoice arrives · Draft: done',
    link: { label: 'See the Work Chart', href: '#/org/x/work-chart' },
  })
  assert.equal(runLinesNotice([line(1, 'failed', { note: 'no inbox' })], '#w')?.message, 'Invoice Bot · Invoice arrives · Draft: failed · no inbox')
  assert.equal(runLinesNotice([line(1, 'failed')], '#w')?.kind, 'bad')
  assert.deepEqual(runLinesNotice([line(1), line(2, 'failed'), line(3)], '#w'), {
    kind: 'bad',
    message: '3 new run-log lines, 1 failed',
    link: { label: 'See the Work Chart', href: '#w' },
  })
  assert.equal(runLinesNotice([line(1), line(2)], '#w')?.message, '2 new run-log lines')
  assert.equal(runLinesNotice([line(1, 'skipped')], '#w')?.kind, 'warn', 'a skipped step is a warning')
  assert.equal(runLinesNotice([line(1), line(2, 'waiting')], '#w')?.kind, 'warn', 'a waiting step is a warning')
  assert.equal(runLinesNotice([line(1, 'waiting'), line(2, 'failed')], '#w')?.kind, 'bad', 'a failure wins over a warning')
})

test('a snapshot notice appears only for a new snapshot with something to sync', () => {
  const status = (stamp: string, writes: number) => ({ snapshot: { stamp, syncedAt: '' }, error: '', plan: { writes } })
  assert.equal(snapshotNotice(undefined, status('a', 4), 'x'), null, 'the first look is the baseline')
  assert.equal(snapshotNotice('a', status('a', 4), 'x'), null)
  assert.equal(snapshotNotice('a', status('b', 0), 'x'), null)
  assert.deepEqual(snapshotNotice('a', status('b', 4), 'x'), {
    kind: 'warn',
    message: 'Grok Bot sent a new snapshot: 4 changes to sync',
    link: { label: 'Review the sync', openSync: 'x' },
  })
  assert.equal(snapshotNotice('', status('b', 1), 'x')?.message, 'Grok Bot sent a new snapshot: 1 change to sync', 'no snapshot before, then one')
})

test('the app shows pop-ups bottom right and the latest live notice under the menu', () => {
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(app, /<NoticeStack \/>/)
  assert.match(workspace, /<NoticeBanner \/>/)
  assert.match(workspace, /pushNotice\(/)
  assert.match(css, /\.notice-stack \{[^}]*position: fixed;[^}]*right:[^}]*bottom:/)
  assert.match(css, /\.notice-pop \{[^}]*border-left: var\(--space-1\) solid var\(--color-green-400\)/, 'done is a green bar')
  assert.match(css, /\.notice-pop\.is-warn \{ border-left-color: var\(--color-amber-700\); \}/, 'a warning is a yellow bar')
  assert.match(css, /\.notice-pop\.is-bad \{ border-left-color: var\(--color-red-700\);/, 'a failure is a red bar')
})
