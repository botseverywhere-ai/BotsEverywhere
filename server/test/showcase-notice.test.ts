import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShowcaseNotice } from '../../src/components/ShowcaseNotice.ts'
import { SHOWCASE_NOTICE, showsShowcaseNotice } from '../../src/content/showcase-notice.ts'

const root = path.resolve(import.meta.dirname, '../..')

test('the notice renders in showcase and not in template mode', () => {
  const showcase = renderToStaticMarkup(createElement(ShowcaseNotice, { mode: 'showcase' }))
  assert.match(showcase, /data-testid="showcase-notice"/)
  assert.match(showcase, /Live preview, nothing here is saved\./)
  assert.ok(showcase.includes(SHOWCASE_NOTICE))
  assert.match(showcase, /class="btn btn-primary"/)
  assert.match(showcase, />Get it on GitHub</)
  assert.match(showcase, /href="#docs"/)
  assert.match(showcase, />How saving works</)

  assert.equal(renderToStaticMarkup(createElement(ShowcaseNotice, { mode: 'template' })), '')
})

test('showcase shows the notice on charts and sample pages only', () => {
  assert.equal(showsShowcaseNotice('showcase', { view: 'org' }), true)
  assert.equal(showsShowcaseNotice('showcase', { view: 'work' }), true)
  assert.equal(showsShowcaseNotice('showcase', { sample: true, view: 'directory' }), true)
  assert.equal(showsShowcaseNotice('showcase', { sample: true, view: 'performance' }), true)
  assert.equal(showsShowcaseNotice('showcase', { view: 'docs' }), false)
  assert.equal(showsShowcaseNotice('showcase', { view: 'directory' }), false)
  assert.equal(showsShowcaseNotice('template', { view: 'org' }), false)
  assert.equal(showsShowcaseNotice('template', { view: 'work' }), false)
  assert.equal(showsShowcaseNotice('template', { sample: true, view: 'org' }), false)
})

test('docs include install steps and example folders for each OS', () => {
  const docs = readFileSync(path.join(root, 'src/pages/DocsPage.tsx'), 'utf8')
  assert.match(docs, /Install on Mac, Windows or Linux/)
  assert.match(docs, /Node\.js LTS and Git/)
  assert.match(docs, /git clone/)
  assert.match(docs, /npm install/)
  assert.match(docs, /npm run dev/)
  assert.match(docs, /http:\/\/127\.0\.0\.1:5199/)
  assert.match(docs, /C:\\Users\\you\\botseverywhere/)
  assert.match(docs, /\/Users\/you\/botseverywhere/)
  assert.match(docs, /\/home\/you\/botseverywhere/)
})

test('showcase edit attempts toast the same notice instead of saving', () => {
  const workspace = readFileSync(path.join(root, 'src/pages/Workspace.tsx'), 'utf8')
  assert.match(workspace, /if \(APP_MODE === 'showcase'\) \{\s*setToast\(SHOWCASE_NOTICE\)/)
  assert.match(workspace, /onEditAttempt=\{showcaseHire \? \(\) => setToast\(SHOWCASE_NOTICE\)/)
  const drawer = readFileSync(path.join(root, 'src/components/SeatDrawer.tsx'), 'utf8')
  assert.match(drawer, />Edit seat</)
})
