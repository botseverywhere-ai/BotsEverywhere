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
  assert.ok(landing.includes('<q>If you automate a broken process, you scale the breakdown</q>.'), 'the period is ours, outside the quote: the article continues with a colon')
  assert.match(landing, /Kulkarni, Bodan, and Kilgour, Deloitte, <a href=\{ARTICLE\} target="_blank" rel="noreferrer"><cite>The work chart vs\. org chart<\/cite><\/a>, June 2026/)
  assert.match(landing, /<a href=\{ARTICLE\} target="_blank" rel="noreferrer">Read the article<\/a>/)
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
  assert.ok(readme.includes('dual licensed under the [MIT License](LICENSE-MIT) or the [Apache License 2.0](LICENSE-APACHE), at your option'))
  assert.ok(landing.includes('dual licensed under the MIT License or the Apache License 2.0, at your option'))
  assert.ok(readme.includes('The BotsEverywhere name and logo are not licensed under either license.'))
  assert.ok(landing.includes('The BotsEverywhere name and logo are not licensed under either license.'))
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
