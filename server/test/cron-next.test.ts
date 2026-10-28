import assert from 'node:assert/strict'
import test from 'node:test'
import { nextCronRun } from '../src/cron-next.ts'

test('the next run of a cron line, in the routine\'s own time zone', () => {
  // 28 Oct 2026 is a Wednesday; Madrid is on winter time (UTC+1) since 25 Oct.
  const at = new Date('2026-10-28T13:00:00.000Z')
  assert.equal(nextCronRun('0 9,21 * * *', 'Europe/Madrid', at), '2026-10-28T20:00:00.000Z', 'today at 21:00 Madrid')
  assert.equal(nextCronRun('0 9 * * 2', 'Europe/Madrid', at), '2026-11-03T08:00:00.000Z', 'next Tuesday at 9:00')
  assert.equal(nextCronRun('0 9 * * 1-5', 'Europe/Madrid', at), '2026-10-29T08:00:00.000Z', 'tomorrow, a weekday')
  assert.equal(nextCronRun('*/20 * * * *', 'Europe/Madrid', new Date('2026-10-28T13:05:00.000Z')), '2026-10-28T13:20:00.000Z')
  assert.equal(nextCronRun('0 9 * * *', 'America/New_York', at), '2026-10-29T13:00:00.000Z', 'another zone')
  assert.equal(nextCronRun('0 9 * * *', 'Europe/Madrid', new Date('2026-10-28T08:00:00.000Z')), '2026-10-29T08:00:00.000Z', 'a run at this very minute is not next')
})

test('a summer-time change moves the next run with the clock', () => {
  // Saturday 24 Oct, Madrid on summer time (UTC+2); the clocks go back early on Sunday 25 Oct.
  assert.equal(nextCronRun('0 9 * * *', 'Europe/Madrid', new Date('2026-10-24T12:00:00.000Z')), '2026-10-25T08:00:00.000Z')
})

test('day of month and day of week: either one matches, as cron does', () => {
  // The 1st of November 2026 is a Sunday; the first Monday after 28 Oct is 2 Nov.
  assert.equal(nextCronRun('0 9 1 * 1', 'Europe/Madrid', new Date('2026-10-28T13:00:00.000Z')), '2026-11-01T08:00:00.000Z')
})

test('what is not a cron line, or a zone that does not exist, gives no next run', () => {
  const at = new Date('2026-10-28T13:00:00.000Z')
  assert.equal(nextCronRun('Slack: mentions in #launch', 'Europe/Madrid', at), '')
  assert.equal(nextCronRun('0 9 * * *', 'Mars/Olympus', at), '')
  assert.equal(nextCronRun('61 9 * * *', 'Europe/Madrid', at), '')
  assert.equal(nextCronRun('0 9 31 2 *', 'Europe/Madrid', at), '', 'never within the window')
})
