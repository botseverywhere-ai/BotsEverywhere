import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { TEMPLATE_HOST } from '../src/template-server.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const landing = read('../../src/pages/Landing.tsx')
const css = read('../../src/styles/landing.css')

test('the homepage quotes the work chart article word for word, credits it, and links to it', () => {
  assert.match(landing, /const ARTICLE = 'https:\/\/www\.deloitte\.com\/us\/en\/what-we-do\/capabilities\/applied-artificial-intelligence\/articles\/role-fusion-organizational-delayering\.html'/)
  const sentence = 'Every layer of management in your organization exists because, at some point, a human being was the most reliable way to gather information, interpret it, and move it to the next decision point—and AI is systematically eliminating that justification.'
  const quoted = 'Every layer of management in your organization exists because, at some point, a human being was the most reliable way to gather information, interpret it, and move it to the next decision point'
  assert.ok(sentence.startsWith(quoted), 'the quote is the article\'s own words, cut where its sentence turns')
  assert.ok(landing.includes(`<p>${quoted}.</p>`))
  assert.ok(landing.includes('<p className="ld-quote-turn">Bots move the work. Humans manage it.</p>'), 'our conclusion, in our voice, after the credit line')
  assert.ok(landing.includes('that second map is the one humans manage.'))
  assert.doesNotMatch(landing, /You manage it|the one you manage/)
  assert.doesNotMatch(landing, /they write|systematically eliminating/)
  assert.ok(landing.includes('<q>If you automate a broken process, you scale the breakdown</q>.'), 'the period is ours, outside the quote: the article continues with a colon')
  assert.match(landing, /Kulkarni, Bodan, and Kilgour, Deloitte, <a href=\{ARTICLE\} target="_blank" rel="noreferrer"><cite>The work chart vs\. org chart<\/cite><\/a>, June 2026/)
  assert.match(landing, /<a href=\{ARTICLE\} target="_blank" rel="noreferrer">Read the article<\/a>/)
})

test('the homepage speaks to one person running bots, not a team of people', () => {
  const demo = read('../../src/pages/DemoHome.tsx')
  for (const page of [landing, demo]) {
    assert.ok(page.includes('Founders copy it to map their bots in one place'), 'the hero names who it is for')
    assert.equal(page.includes('team of people and bots'), false)
  }
  for (const line of ['Every seat has a written card', 'Ten fictional organizations, each one person and their bots.', 'One person and their bots in one tree.', 'one card per seat']) assert.ok(landing.includes(line), line)
  for (const gone of ['person or bot', 'Ten fictional teams', 'People and bots in one tree', 'not just the people']) assert.equal(landing.includes(gone), false, gone)
  assert.ok(landing.includes('<h2 id="why-work-chart-title">Map the work, triggers, handoffs and routines by bots.</h2>'))
  assert.ok(read('../../src/components/file-guide-copy.ts').includes("seats: 'One file per seat:"))
})

test('every homepage claim about the app matches the app', () => {
  assert.equal(TEMPLATE_HOST, '127.0.0.1')
  assert.ok(landing.includes('listen on 127.0.0.1'))
  const processes = read('../src/processes.ts')
  for (const verb of ['send', 'pay', 'post', 'book', 'merge', 'publish', 'delete']) assert.ok(processes.includes(`'${verb}'`), `${verb} is a checkpoint verb`)
  assert.ok(landing.includes('A step that sends, pays, posts, books, merges, publishes, or deletes waits for a named human.'))
  const docs = read('../../src/pages/DocsPage.tsx')
  assert.ok(docs.includes('no analytics, no telemetry, and no third-party scripts'), 'Docs says the same about tracking')
  assert.ok(docs.includes('stores no passwords, tokens, or API keys'), 'Docs says the same about keys')
  const readme = read('../../README.md')
  assert.ok(readme.includes('BotsEverywhere is open source under the [MIT License](LICENSE)'), 'one license, MIT')
  assert.ok(landing.includes('BotsEverywhere is open source under the MIT License.'))
  assert.ok(readme.includes('The BotsEverywhere name and logo are not covered by the license.'))
  assert.ok(landing.includes('The BotsEverywhere name and logo are not covered by the license.'))
  for (const gone of ['Apache', 'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE']) {
    assert.ok(!readme.includes(gone) && !landing.includes(gone) && !docs.includes(gone), `${gone} is gone: the project is MIT only`)
  }
  const license = read('../../LICENSE')
  assert.match(license, /^The MIT License \(MIT\)\n\nCopyright \(c\) 20\d\d [^\n]+\n/, 'the FastAPI form: title, blank line, one copyright line')
  for (const part of ['org.md', 'seats/', 'processes/', 'log/']) assert.ok(landing.includes(part), part)
})

test('homepage wording and layout rules: organization, open source, square corners, no sideways scroll', () => {
  assert.doesNotMatch(landing, /\bcompany\b|free template/i)
  assert.match(landing, /id="why-work-chart"/)
  assert.match(landing, /id="local"/)
  assert.match(landing, /id="open-source"/)
  const added = css.slice(css.indexOf('/* Why a work chart'))
  assert.ok(added.length > 0)
  assert.doesNotMatch(added, /border-radius:(?!\s*var\(--control-radius\))/, 'every corner in the new sections uses the control radius')
  assert.match('a { border-radius: 12px; }', /border-radius:(?!\s*var\(--control-radius\))/, 'and the check does catch a rounded corner')
  assert.match(css, /\.ld-oss > \*, \.ld-idea > \* \{ min-width: 0; \}/, 'grid columns can shrink, so the folder diagram scrolls in its box on a phone')
  assert.match(css, /\.ld-steps, \.ld-trust \{ grid-template-columns: 1fr; \}/)
})

test('the homepage has no dashes in its text, and ends on the ink closing band', () => {
  assert.doesNotMatch(landing, /[\u2013\u2014]/, 'no en or em dash anywhere on the page')
  assert.match(landing, /<section className="ld-closing">\s+<div className="ld-wrap ld-final">\s+<h2>Map your team\. Staff the seats\.<\/h2>/)
  assert.match(css, /\.ld-closing \{ background: var\(--color-ink\); color: var\(--color-inverse\); \}/)
  assert.match(css, /\.ld-closing \.btn-primary[^{]*\{ background: var\(--color-white\); color: var\(--color-ink\);/, 'the main button stays visible on ink')
})

test("the homepage follows the article's blueprint in its own order and words, and says the charts as the app has them", () => {
  const steps = [...landing.matchAll(/\{ step: '([^']+)', app: '([^']+)'/g)].map((match) => [match[1], match[2]])
  assert.deepEqual(steps, [['Map the work', 'Work chart'], ['Instrument governance', 'Run log'], ['Fuse roles selectively', 'Seat cards'], ['Add guardrails', 'Checkpoints']], "the article's steps 1 to 4, in its order")
  assert.doesNotMatch(landing, /ld-steps-intro|rebuilding the career ladder/)
  assert.ok(landing.includes('The org chart shows who owns what. The work chart shows how work moves.'), 'both charts hold people and bots, as in the app')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.ok(workspace.includes('Org chart = who owns capability. Work chart = how work moves.'), "the same idea as the app's own caption")
  assert.doesNotMatch(landing, /Org chart for bots|keep the approve/)
})
