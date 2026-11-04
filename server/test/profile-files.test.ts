import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { profileFileLines } from '../src/profile-files.ts'
import { latestProfileReports } from '../src/profile-reports.ts'

test('profiles bots wrote to their organization folders read like ones they sent, dated when written; a file for another org or seat, or one that cannot be read, is skipped', () => {
  const orgs = mkdtempSync(join(tmpdir(), 'be-profile-files-'))
  try {
    const folder = join(orgs, 'org-a', 'profiles')
    mkdirSync(folder, { recursive: true })
    const write = (name: string, text: string, at = new Date('2026-10-28T18:00:00.000Z')) => {
      writeFileSync(join(folder, name), text)
      utimesSync(join(folder, name), at, at)
    }
    write('x-com.md', '﻿BotsEverywhere profile: org-a | x-com\r\nRoutines:\r\n- Milestone check | 0 9,21 * * * | Europe/Madrid | paused | never | 58\r\nSkills:\r\n- graph-skill | Export the team\r\n')
    write('lead.md', 'BotsEverywhere profile: org-b | lead\nRoutines:\n- none')
    write('helper.md', 'BotsEverywhere profile: org-a | someone-else\nRoutines:\n- none')
    write('garbage.md', '\u0000\u0001 not a profile')
    write('notes.txt', 'BotsEverywhere profile: org-a | notes\nRoutines:\n- none')
    mkdirSync(join(folder, 'folder.md'))
    const lines = profileFileLines(orgs, ['org-a', 'org-missing'])
    assert.deepEqual(lines.map((line) => [line.from, line.at]), [['x-com', '2026-10-28T18:00:00.000Z']])
    const report = latestProfileReports(lines).get('org-a|x-com')!
    assert.equal(report.routines[0]!.enabled, false)
    assert.equal(report.routineRuns30d, 58)
    assert.deepEqual(report.skills, [{ name: 'graph-skill', description: 'Export the team' }])
    const newer = latestProfileReports([{ line: 'BotsEverywhere profile: org-a | x-com\nRoutines:\n- none', from: 'x.com', at: '2026-10-28T17:00:00+01:00' }, ...lines]).get('org-a|x-com')!
    assert.equal(newer.routineRuns30d, 58, 'the file, written later than the message, wins')
  } finally {
    rmSync(orgs, { recursive: true, force: true })
  }
})
