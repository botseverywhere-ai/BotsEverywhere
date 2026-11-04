import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { slugify } from '../src/grok-sync.ts'

test('Add a seat: the short name keeps capitals and spaces, and the file name is made from it', () => {
  assert.equal(slugify('Co Founder'), 'co-founder')
  assert.equal(slugify('  Site Bot!  '), 'site-bot')
  assert.equal(slugify('***'), '', 'nothing usable is refused by the form')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(workspace, /setSlug\(event\.target\.value\.trim\(\)\.toLowerCase\(\)\)/, 'typing is no longer lowercased or trimmed')
  assert.match(workspace, /<input value=\{shortName\} onChange=\{\(event\) => setShortName\(event\.target\.value\)\} \/>/)
  assert.match(workspace, /const slug = slugify\(shortName\)/)
})

test('Add a seat: Reports to marks the no-manager choice so it is easy to find', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /<select value=\{reportsTo\} onChange=\{\(event\) => setReportsTo\(event\.target\.value\)\}>\s*<option value="">\*\*\* Top of the chart \*\*\*<\/option>/)
})
