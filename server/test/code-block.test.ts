import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeBlock } from '../../src/components/CodeBlock.tsx'

const root = path.resolve(import.meta.dirname, '../..')

test('every docs code block has a copy button', () => {
  const docs = readFileSync(path.join(root, 'src/pages/DocsPage.tsx'), 'utf8')
  const block = readFileSync(path.join(root, 'src/components/CodeBlock.tsx'), 'utf8')
  const css = readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')

  assert.equal(docs.includes('<pre'), false)
  assert.equal(docs.match(/<CodeBlock/g)?.length, 7)
  assert.match(docs, /<this-repository-url>/)
  assert.match(block, /navigator\.clipboard\.writeText\(children\)/)
  assert.match(block, /Copied/)
  assert.match(block, /2000/)

  const html = renderToStaticMarkup(createElement(CodeBlock, null, 'git clone <this-repository-url>\nnpm install'))
  assert.match(html, /class="code-block-bar"/)
  assert.match(html, /class="code-block-label"/)
  assert.match(html, />Terminal</)
  assert.match(html, /class="code-block-copy"/)
  assert.match(html, />Copy</)
  assert.doesNotMatch(html, /btn-secondary/)
  assert.match(html, /<pre>git clone &lt;this-repository-url&gt;\nnpm install<\/pre>/)

  assert.match(css, /\.docs \.code-block \{[^}]*margin: var\(--space-4\) 0/)
  assert.match(css, /\.docs \.code-block \{[^}]*border-radius: var\(--radius-md\)/)
  assert.match(css, /\.docs \.code-block-bar \{[^}]*background: var\(--color-navy\)/)
  assert.match(css, /\.docs \.code-block pre \{[^}]*padding: 20px/)
  assert.match(css, /\.docs \.code-block pre \{[^}]*font-family: var\(--font-mono\)/)
  assert.match(css, /\.docs \.code-block pre \{[^}]*background: var\(--color-ink\)/)
  assert.match(css, /\.docs \.code-block-copy \{[^}]*border: 0/)
  assert.match(css, /\.docs \.code-block-copy \{[^}]*background: transparent/)
  assert.match(block, /width: 14/)
  assert.match(css, /\.docs pre \{[^}]*border-radius: var\(--control-radius\)/)
  assert.doesNotMatch(css, /\.docs pre \{[^}]*border-radius: 12px/)
})
