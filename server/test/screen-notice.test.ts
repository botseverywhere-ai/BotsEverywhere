import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DESKTOP_MIN_WIDTH, SCREEN_NOTICE, showsScreenNotice } from '../../src/content/screen-notice.ts'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

test('below 1024px a quiet notice says BotsEverywhere is built for desktop, and never blocks the page', () => {
  assert.equal(DESKTOP_MIN_WIDTH, 1024)
  assert.equal(showsScreenNotice(1023, false), true)
  assert.equal(showsScreenNotice(1024, false), false)
  assert.equal(showsScreenNotice(390, true), false, 'closed for this visit')
  assert.equal(SCREEN_NOTICE, 'BotsEverywhere is built for desktop screens 1024px and wider. Some pages may not fit here. It is open source, so you can adapt the layout to your needs.')
  assert.equal(/\bcompany\b/i.test(SCREEN_NOTICE), false)
})

test('the notice shows on every page, and Docs states the same minimum', () => {
  const app = read('../../src/App.tsx')
  assert.match(app, /<ScreenNotice \/>[\s\S]*<Landing \/>/, 'the home page too')
  const docs = read('../../src/pages/DocsPage.tsx')
  assert.match(docs, /DESKTOP_MIN_WIDTH/)
  assert.match(docs, /Does it work on phones\?/)
})
