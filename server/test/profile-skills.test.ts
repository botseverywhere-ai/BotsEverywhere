import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { BotProfile } = await import('../../src/components/BotProfile.tsx')
  const seat = { id: 'x-com', name: 'x.com', origin: 'imported', grokSync: 'synced', grokBotUrl: 'grokbot://app/v1/agent?id=x', directoryId: '', skills: [{ name: 'x-build-log', description: 'Build-in-public posts.' }, { name: 'draft-skill', description: 'Not sent yet.' }], routines: [] }
  return renderToStaticMarkup(React.createElement(BotProfile, { seat, grokRequestedAt: '', onProfile: () => undefined, onUpdateInGrok: () => undefined, ...props }))
}

const REPORTED = [{ name: 'x-build-log', description: 'Build-in-public posts.' }, { name: 'x-com-communication-guidelines-spacexsi', description: 'Checks every public post against the guidelines.' }]

test("Profile shows one list of skills: a skill the bot has in Grok Bot is locked, with no remove button, whether or not it was added here", async () => {
  const html = await render({ reportedSkills: REPORTED })
  const section = /<section class="profile-list">[\s\S]*?<h3 class="card-label">Skills<\/h3>[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
  assert.ok(section, 'one Skills section')
  assert.doesNotMatch(section, /Used in its work, as the bot reported them/, 'no second list')
  assert.match(section, /<li class="skill-locked"><strong>x-build-log<\/strong><span class="connect-badge is-connected"><i aria-hidden="true"><\/i>In Grok Bot<\/span><span class="profile-line">Build-in-public posts\.<\/span><\/li>/)
  assert.match(section, /<li class="skill-locked"><strong>x-com-communication-guidelines-spacexsi<\/strong><span class="connect-badge is-connected"><i aria-hidden="true"><\/i>In Grok Bot<\/span><span class="profile-line">Checks every public post against the guidelines\.<\/span><\/li>/)
  assert.equal((section.match(/aria-label="Remove skill"/g) ?? []).length, 1, 'only the skill not in Grok Bot yet can be removed')
  assert.match(section, /<input class="text-input" aria-label="Skill name" placeholder="New skill" value="draft-skill"/)
  assert.doesNotMatch(section, /<input[^>]*value="x-build-log"/, 'a locked skill is not an input')
  assert.match(section, /A skill the bot has in Grok Bot stays there: remove it in Grok Bot\. A skill added here goes to the bot with Update bot and can be removed until then\./)
})

test('before the bot has reported, every skill added here is still editable and removable', async () => {
  const html = await render({})
  const section = /<section class="profile-list">[\s\S]*?<h3 class="card-label">Skills<\/h3>[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
  assert.equal((section.match(/aria-label="Remove skill"/g) ?? []).length, 2)
  assert.doesNotMatch(section, /skill-locked/)
})

test('a locked skill that was added here stays on the seat when another row is removed', async () => {
  const { keptSkills } = await import('../../src/components/bot-profile-copy.ts')
  const seat = [{ name: 'x-build-log', description: 'Posts.' }, { name: 'draft-skill' }]
  assert.deepEqual(keptSkills(seat, ['x-build-log'], 1), [{ name: 'x-build-log', description: 'Posts.' }], 'removing the draft keeps the locked one')
  assert.deepEqual(keptSkills(seat, ['x-build-log'], 0), seat, 'a locked row cannot be removed')
})

test("what a bot has in Grok Bot is the Connector's reading plus what the bot reports it uses, each once, so no skill the bot has goes missing from Profile", async () => {
  const { knownInGrok } = await import('../../src/org/bot-skills.ts')
  const fromBlock = [{ name: 'x-build-log', description: 'Posts.' }, { name: 'launch-thread', description: 'Thread.' }]
  const reported = [{ name: 'X-Build-Log', description: 'posts (the bot)' }, { name: 'x-com-communication-guidelines-spacexsi', description: 'Guidelines.' }]
  assert.deepEqual(knownInGrok(fromBlock, reported), [...fromBlock, { name: 'x-com-communication-guidelines-spacexsi', description: 'Guidelines.' }], "the Connector's reading first, then the bot's own extras")
  assert.deepEqual(knownInGrok(undefined, reported), reported, 'before the Connector shows a block, the report alone')
  assert.deepEqual(knownInGrok(fromBlock, undefined), fromBlock)
  assert.equal(knownInGrok(undefined, undefined), undefined, 'nothing known yet')
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /reportedSkills=\{knownInGrok\(chartBot\?\.grokSkills, chartBot\?\.skills\)\}/)
})
