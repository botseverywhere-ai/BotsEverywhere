import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')

const banned = /btn-primary|btn-secondary|btn-ghost|btn-navy|btn-sm|ld-btn|dir-back-btn|createElement\(\s*['"]a['"]\s*,\s*\{[^}]*\bbtn\b/
const rawButton = /createElement\(\s*['"]button['"]/
const control = /role=["']tab["']|be-step|text-button|be-icon|be-principle|be-principles-toggle|be-hire-link|be-step-chip|dir-search-clear|lane-head|exception-chip|step-chip|step-dots|unstaffed-icon|org-card-hit|org-toggle|team-pick|process-step|process-next|\bchip\b/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function buttonTags(text: string): string[] {
  const tags: string[] = []
  let i = 0
  while (i < text.length) {
    const at = text.indexOf('<button', i)
    if (at === -1) break
    const end = text.indexOf('>', at)
    tags.push(text.slice(at, end + 1))
    i = end + 1
  }
  return tags
}

test('action buttons use the shared Button component', () => {
  const hits: string[] = []
  for (const file of walk(src)) {
    if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue
    if (file.endsWith(`${path.sep}Button.tsx`)) continue
    const text = readFileSync(file, 'utf8')
    const rel = path.relative(root, file)
    if (banned.test(text)) hits.push(`${rel}: hardcoded button class`)
    if (rawButton.test(text) && !/createElement\(\s*['"]button['"][\s\S]{0,160}code-block-copy/.test(text)) {
      hits.push(`${rel}: raw button`)
    }
    for (const tag of buttonTags(text)) {
      if (!control.test(tag)) hits.push(`${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 140)}`)
    }
  }
  assert.deepEqual(hits, [])
})

test('button metrics live in tokens.css', () => {
  const css = readFileSync(path.join(src, 'styles', 'tokens.css'), 'utf8')
  assert.match(css, /--btn-height:\s*36px/)
  assert.match(css, /--btn-font-size:\s*var\(--text-sm\)/)
  assert.match(css, /--btn-radius:\s*var\(--control-radius\)/)
  assert.match(css, /--control-radius:\s*0/)
  assert.match(css, /--radius-compact:\s*0/)
  assert.match(css, /--focus-ring:/)
  const button = readFileSync(path.join(src, 'components', 'Button.tsx'), 'utf8')
  assert.match(button, /btn-\$\{variant\}/)
  assert.equal(button.includes('style='), false)
})
