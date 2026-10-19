import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'
import { CopyPromptButton, GrokBotLink, copyPrompt } from '../../src/directory/prompt-actions.ts'
import { parseHash } from '../../src/routing.ts'
import { directoryHireState } from '../../src/directory/hire-state.ts'
import {
  CORE_EVERYDAY,
  CORE_WORKCHART,
  DIRECTORY_CATEGORIES,
  FEATURED_SLUGS,
  isDirectoryBotFile,
  parseDirectoryMarkdown,
  validateDirectoryCatalog,
  type DirectoryBot,
} from '../src/directory-entries.ts'

describe('bot directory', () => {
  it('covers the new frontmatter and the shipped Grok Bot links', () => {
    const dir = resolve('directory')
    const bots: DirectoryBot[] = []
    for (const name of readdirSync(dir).filter((item) => isDirectoryBotFile(item)).sort()) {
      const slug = name.replace(/\.md$/, '')
      const parsed = parseDirectoryMarkdown(slug, readFileSync(resolve(dir, name), 'utf8'))
      assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.errors.join('\n'))
      if (parsed.ok) bots.push(parsed.bot)
    }
    assert.deepEqual(validateDirectoryCatalog(bots), [])
    assert.equal(bots.length, 138)
    const legalAdvice = [
      'contract-bot',
      'contract-clause-bot',
      'nda-bot',
      'contract-date-bot',
      'policy-change-bot',
      'audit-evidence-bot',
      'vendor-form-bot',
      'terms-bot',
      'claim-bot',
      'data-check-bot',
      'access-check-bot',
      'privacy-request-bot',
      'policy-ack-bot',
    ]
    for (const slug of legalAdvice) {
      const bot = bots.find((item) => item.slug === slug)
      assert.ok(bot, slug)
      assert.match(bot.prompt, /do not give legal advice/i)
      assert.match(bot.prompt, /counsel/i)
    }
    const queue = readFileSync(resolve('directory/PUBLISH-QUEUE.md'), 'utf8')
    for (const bot of bots) {
      if (bot.addToGrokBotUrl === null) {
        assert.ok(queue.includes(`\`${bot.slug}\``), bot.slug)
        assert.ok(queue.includes(bot.name), bot.name)
      } else {
        assert.equal(queue.includes(`\`${bot.slug}\``), false, bot.slug)
      }
    }
    assert.deepEqual(DIRECTORY_CATEGORIES.length, 19)
    assert.ok(DIRECTORY_CATEGORIES.includes('Legal & Compliance'))
    assert.equal((DIRECTORY_CATEGORIES as readonly string[]).includes('Legal/Compliance'), false)
    assert.equal((DIRECTORY_CATEGORIES as readonly string[]).includes('Compliance'), false)
    assert.equal(bots.filter((bot) => bot.category === 'Legal & Compliance').length, 14)
    assert.equal(bots.some((bot) => bot.category === 'Legal/Compliance' || bot.category === 'Compliance'), false)
    assert.match(queue, /## Legal & Compliance/)
    assert.equal(queue.includes('## Legal/Compliance'), false)
    assert.equal(/^## Compliance$/m.test(queue), false)
    assert.deepEqual(
      bots.filter((bot) => bot.featured).map((bot) => bot.slug).sort(),
      [...FEATURED_SLUGS].sort(),
    )
    const featuredBlock = queue.split('## ')[1] ?? ''
    assert.match(queue, /## Featured/)
    for (const slug of FEATURED_SLUGS) {
      const featured = bots.find((bot) => bot.slug === slug)
      if (featured?.addToGrokBotUrl === null) {
        assert.ok(featuredBlock.includes(`\`${slug}\``), slug)
      } else {
        assert.equal(featuredBlock.includes(slug), false, slug)
      }
    }
    const page = readFileSync(resolve('src/pages/DirectoryPage.tsx'), 'utf8')
    assert.match(page, /Back to all bots/)
    assert.match(page, /Search bots by name or job/)
    assert.match(page, /variant="ghost" back/)
    assert.match(page, /dir-search-clear/)
    assert.match(page, /dir-card-link/)
    assert.match(page, /label="Add"/)
    assert.match(page, /has-add/)
    assert.match(page, /Everyday bots/)
    assert.match(page, /Work chart bots/)
    assert.match(page, /dir-hire-reason/)
    assert.equal(page.includes('Open your own org with the file writer running'), false)
    assert.equal(page.includes('Start here'), false)
    assert.deepEqual(
      CORE_EVERYDAY.map((slug) => bots.find((bot) => bot.slug === slug)?.group),
      CORE_EVERYDAY.map(() => 'Everyday'),
    )
    assert.deepEqual(
      CORE_WORKCHART.map((slug) => bots.find((bot) => bot.slug === slug)?.group),
      CORE_WORKCHART.map(() => 'Work chart'),
    )
    assert.equal(bots.filter((bot) => bot.core).length, 20)
    const meetup = bots.find((bot) => bot.slug === 'meetup-bot')
    assert.equal(meetup?.core, false)
    assert.equal(meetup?.featured, true)
    const contract = bots.find((bot) => bot.slug === 'contract-bot')
    assert.match(contract?.prompt ?? '', /not legal advice/i)
    assert.match(contract?.prompt ?? '', /consult a lawyer/i)
    assert.equal(bots.find((bot) => bot.slug === 'collections-bot')?.name, 'Payment Reminder Bot')
    assert.equal(bots.find((bot) => bot.slug === 'expense-bot')?.name, 'Bookkeeping Bot')
    const linked = bots.filter((bot) => bot.addToGrokBotUrl !== null)
    assert.deepEqual(
      linked.map((bot) => [bot.slug, bot.addToGrokBotUrl]),
      [
        ['chief-of-staff-bot', 'https://x.ai/bot/y8nNE3shBrsRsPC84HEya'],
        ['collections-bot', 'https://x.ai/bot/NF4qkBUzYarUDzHCHzgCQ'],
        ['expense-bot', 'https://x.ai/bot/KmHQj6zuZ6lhHMvFrEHdE'],
        ['inbox-bot', 'https://x.ai/bot/ZL8ptFUtOeRHVd3EXdNBP'],
        ['onboarding-bot', 'https://x.ai/bot/xUs-Agw8UFYUkVWB0IZIT'],
        ['request-bot', 'https://x.ai/bot/vo0M33aqIR7cjE6BPujOA'],
        ['sales-follow-up-bot', 'https://x.ai/bot/54Kkr4q9qwZmmy9-XdbZV'],
      ],
    )
  })

  it('keeps directory markdown off the homepage module graph', () => {
    const landing = readFileSync(resolve('src/pages/Landing.tsx'), 'utf8')
    const main = readFileSync(resolve('src/main.tsx'), 'utf8')
    const app = readFileSync(resolve('src/App.tsx'), 'utf8')
    const workspace = readFileSync(resolve('src/pages/Workspace.tsx'), 'utf8')
    assert.equal(landing.includes('directory/load'), false)
    assert.equal(landing.includes('directory-entries.json'), false)
    assert.equal(main.includes('directory/load'), false)
    assert.equal(app.includes('directory/load'), false)
    assert.match(workspace, /import\('\.\/DirectoryPage'\)/)
  })

  it('routes #/directory/<slug> and #directory/<slug>', () => {
    assert.deepEqual(parseHash('#directory'), { view: 'directory', slug: '' })
    assert.deepEqual(parseHash('#/directory'), { view: 'directory', slug: '' })
    assert.deepEqual(parseHash('#/directory/invoice-bot'), { view: 'directory', slug: 'invoice-bot' })
    assert.deepEqual(parseHash('#directory/invoice-bot'), { view: 'directory', slug: 'invoice-bot' })
  })

  it('copies the prompt and hides Add to Grok Bot when there is no link', async () => {
    let written = ''
    const message = await copyPrompt('Paste this into the bot.', async (value) => {
      written = value
    })
    assert.equal(written, 'Paste this into the bot.')
    assert.equal(message, 'Prompt copied')

    const copy = renderToStaticMarkup(createElement(CopyPromptButton, { text: 'Hello prompt', onCopied: () => undefined }))
    assert.match(copy, /Copy prompt/)
    assert.match(copy, /<button/)

    const hidden = renderToStaticMarkup(createElement(GrokBotLink, { url: null }))
    assert.equal(hidden, '')
    assert.equal(renderToStaticMarkup(createElement(GrokBotLink, { url: '' })), '')

    const page = readFileSync(resolve('src/pages/DirectoryPage.tsx'), 'utf8')
    const addAt = page.indexOf('<GrokBotLink url={bot.addToGrokBotUrl} />')
    const copyAt = page.indexOf('<CopyPromptButton')
    const hireAt = page.indexOf('Hire into team')
    assert.ok(addAt > 0 && copyAt > addAt && hireAt > copyAt)

    const linked = renderToStaticMarkup(createElement(GrokBotLink, { url: 'https://x.ai/bot/example' }))
    assert.match(linked, /Add to Grok Bot/)
    assert.match(linked, /class="btn btn-primary dir-add"/)
    assert.match(linked, /href="https:\/\/x\.ai\/bot\/example"/)
    assert.match(linked, /target="_blank"/)
    assert.match(linked, /rel="noopener"/)
    assert.equal(linked.includes('disabled'), false)
    const cardAdd = renderToStaticMarkup(createElement(GrokBotLink, { url: 'https://x.ai/bot/ZL8ptFUtOeRHVd3EXdNBP', label: 'Add' }))
    assert.match(cardAdd, />Add</)
    assert.equal(cardAdd.includes('Add to Grok Bot'), false)
    assert.match(cardAdd, /href="https:\/\/x\.ai\/bot\/ZL8ptFUtOeRHVd3EXdNBP"/)
    assert.equal(renderToStaticMarkup(createElement(GrokBotLink, { url: 'https://example.com/bot', label: 'Add' })), '')
  })

  it('enables Hire into team for every template bot unless saving is off or the seat exists', () => {
    assert.deepEqual(
      directoryHireState({ sample: false, writer: 'up', alreadySeated: false, name: 'Role Card Bot' }),
      { enabled: true, reason: '' },
    )
    assert.deepEqual(
      directoryHireState({ sample: false, writer: 'unknown', alreadySeated: false, name: 'Role Card Bot' }),
      { enabled: true, reason: '' },
    )
    const down = directoryHireState({ sample: false, writer: 'down', alreadySeated: false, name: 'Role Card Bot' })
    assert.equal(down.enabled, false)
    assert.match(down.reason, /Restart npm run dev/)
    const seated = directoryHireState({ sample: false, writer: 'up', alreadySeated: true, name: 'Role Card Bot' })
    assert.equal(seated.enabled, false)
    assert.match(seated.reason, /already on your org chart/)
    const sample = directoryHireState({ sample: false, writer: 'up', alreadySeated: false, name: 'Support Bot' })
    assert.equal(sample.enabled, true)
    assert.equal(directoryHireState({ sample: true, writer: 'up', alreadySeated: false, name: 'Role Card Bot' }).enabled, false)
  })
})
