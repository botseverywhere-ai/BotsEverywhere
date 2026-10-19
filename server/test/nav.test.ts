import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parseHash } from '../../src/routing.ts'

const root = path.resolve(import.meta.dirname, '../..')

test('the homepage subtitle sits under the headline', () => {
  const landing = readFileSync(path.join(root, 'src/pages/Landing.tsx'), 'utf8')
  const css = readFileSync(path.join(root, 'src/styles/landing.css'), 'utf8')
  const headline = landing.indexOf('The open source team management tool for bots.')
  const subtitle = landing.indexOf('Structured and organized teams powered with Grok Bot')
  assert.ok(headline > -1)
  assert.ok(subtitle > headline)
  assert.match(css, /\.ld-hero \.ld-subhead \{[^}]*color: var\(--color-muted\)/)
  assert.match(css, /\.ld-hero \.ld-subhead \{[^}]*font-size: var\(--text-2xl\)/)
  assert.match(css, /\.ld-hero \.ld-subhead \{[^}]*font-weight: var\(--weight-regular\)/)
  assert.match(css, /\.ld-hero \.ld-subhead \{[^}]*margin: var\(--space-4\)/)
  assert.match(css, /\.ld-hero \.ld-subhead \{ font-size: var\(--text-lg\); \}/)
})

test('the main menu is Directory, Templates, and Docs, and orgs use a tab row', () => {
  const nav = readFileSync(path.join(root, 'src/components/SiteNav.tsx'), 'utf8') + readFileSync(path.join(root, 'src/nav-target.ts'), 'utf8')
  const labels = ['Bot Directory', 'Templates', 'Docs']
  let at = -1
  for (const label of labels) {
    const next = nav.indexOf(`'${label}'`, at + 1)
    assert.ok(next > at, label)
    at = next
  }
  assert.ok(nav.includes("'Open your org'"))
  assert.ok(nav.includes("'Get it on GitHub'"))
  assert.equal(nav.includes('SampleNav'), false)
  assert.equal(nav.includes('Demos'), false)
  for (const href of ['#/directory', '#/templates', '#/docs', '#/orgs']) {
    assert.ok(nav.includes(`'${href}'`), href)
  }

  const tabs = readFileSync(path.join(root, 'src/components/OrgTabs.tsx'), 'utf8')
  const tabLabels = ['Organization Overview', 'Connect bots', 'Org Chart', 'Work Chart', 'Performance', 'Logs', 'Backup']
  at = -1
  for (const label of tabLabels) {
    const next = tabs.indexOf(`'${label}'`, at + 1)
    assert.ok(next > at, label)
    at = next
  }

  const workspace = readFileSync(path.join(root, 'src/pages/Workspace.tsx'), 'utf8')
  assert.equal(workspace.includes('be-subbar'), false)
  assert.equal(workspace.includes('PrinciplesStrip'), false)
  assert.equal(workspace.includes('Data ▾'), false)
  assert.equal(workspace.includes('Your org ·'), false)
  assert.match(workspace, /Back to templates/)
  assert.match(workspace, /variant="ghost" back href="#templates"/)
  assert.match(workspace, /Template: \{company\.org\.name\}/)
  assert.match(workspace, /Use this template/)
  assert.match(workspace, /<OrgTabs/)

  const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /OrgPicker/)
  assert.match(app, /view=\{viewForTab\(tab\)\}/)

  const templates = readFileSync(path.join(root, 'src/pages/DemoHome.tsx'), 'utf8')
  assert.match(templates, />Templates</)
  assert.equal(templates.includes('<h3>Your company</h3>'), false)
  assert.equal(templates.includes('Demos'), false)
  assert.match(templates, /#\/template\//)

  const docs = readFileSync(path.join(root, 'src/pages/DocsPage.tsx'), 'utf8')
  assert.match(docs, /id="files">Import and export/)
  assert.match(docs, /org\.md/)
  assert.equal(docs.includes('>Demos<'), false)
  const footer = readFileSync(path.join(root, 'src/components/AppFooter.tsx'), 'utf8')
  assert.match(footer, />Settings</)

  assert.equal(parseHash('#templates').view, 'home')
  assert.equal(parseHash('#/templates').view, 'home')
  assert.equal(parseHash('#demos').view, 'home')
  assert.equal(parseHash('#home').view, 'home')
  assert.equal(parseHash('#orgs').view, 'orgs')
  assert.deepEqual(parseHash('#/org/your-company/overview'), { view: 'org-area', slug: 'your-company', tab: 'overview', template: false })
  assert.deepEqual(parseHash('#/org/your-company/org-chart'), { view: 'org-area', slug: 'your-company', tab: 'org-chart', template: false })
  assert.deepEqual(parseHash('#/org/your-company/work-chart'), { view: 'org-area', slug: 'your-company', tab: 'work-chart', template: false })
  assert.deepEqual(parseHash('#/org/your-company/performance'), { view: 'org-area', slug: 'your-company', tab: 'performance', template: false })
  assert.deepEqual(parseHash('#/org/your-company/logs'), { view: 'org-area', slug: 'your-company', tab: 'logs', template: false })
  assert.deepEqual(parseHash('#/org/your-company/connect-bots'), { view: 'org-area', slug: 'your-company', tab: 'connect-bots', template: false })
  assert.deepEqual(parseHash('#/org/your-company/backup'), { view: 'org-area', slug: 'your-company', tab: 'backup', template: false })
  assert.deepEqual(parseHash('#/template/harbor/overview'), { view: 'org-area', slug: 'harbor', tab: 'overview', template: true })
  assert.equal(parseHash('#org').view, 'org')
  assert.equal(parseHash('#work').view, 'work')
  assert.equal(parseHash('#sample/harbor').view, 'sample')
})
