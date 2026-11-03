import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/** tsx compiles JSX in src/ with the classic runtime here (the root tsconfig sets no jsx), so React must be a global. */
async function render(props: Record<string, unknown>): Promise<string> {
  const React = await import('react')
  Object.assign(globalThis, { React })
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { PerformanceStatus } = await import('../../src/components/PerformanceStatus.tsx')
  return renderToStaticMarkup(React.createElement(PerformanceStatus, { orgSlug: 'org-trav3fcs', connected: true, reported: 2, total: 21, waitingAsks: 0, onAsk: () => undefined, ...props }))
}

test('Performance says where its numbers come from: Not connected with a link until the Connector runs, Connected after', async () => {
  const before = await render({ connected: false })
  assert.match(before, /<dt>Status<\/dt><dd class="connect-status"><span class="connect-badge"><i aria-hidden="true"><\/i>Not connected<\/span>/)
  assert.match(before, /<a href="#\/org\/org-trav3fcs\/connect-bots">Connect Grok Bot<\/a>/)
  const after = await render({})
  assert.match(after, /<span class="connect-badge is-connected"><i aria-hidden="true"><\/i>Connected<\/span><span class="connect-status-detail">Created, Times used, Last active, and Apps used come from Grok Bot on every Connector run\.<\/span>/)
  assert.doesNotMatch(after, /Connect Grok Bot/)
})

test("Bot reports counts the bots that have written their profile, amber until all have, green when every bot has", async () => {
  const some = await render({ reported: 2, total: 21 })
  assert.match(some, /<dt>Bot reports<\/dt><dd class="connect-status"><span class="connect-badge"><i aria-hidden="true"><\/i>2 of 21 bots reported<\/span>/)
  assert.match(some, /Automated tasks done and Skills come from each bot&#x27;s own report\. Bots report on their own when they next run; Get the bots&#x27; profiles asks all of them now\./)
  assert.match(some, /<button[^>]*>Get the bots&#x27; profiles<\/button>/)
  const all = await render({ reported: 21, total: 21 })
  assert.match(all, /<span class="connect-badge is-connected"><i aria-hidden="true"><\/i>All 21 bots reported<\/span>/)
  const one = await render({ reported: 0, total: 1 })
  assert.match(one, /0 of 1 bots reported/)
})

test('while asks wait for the owner, the block shows the one sentence to say in the Connector chat, in plain words and with no button', async () => {
  const waiting = await render({ waitingAsks: 21 })
  assert.match(waiting, /<dt>Waiting for you<\/dt><dd class="connect-status"><span class="connect-status-detail">21 asks are ready\. Grok Bot sends them only from a chat: in the Connector&#x27;s chat in Grok Bot, say: <strong>Send the waiting items<\/strong><\/span><\/dd>/)
  assert.doesNotMatch(waiting, /do YOU now|Copy:/)
  assert.doesNotMatch(waiting, /<button[^>]*>Get the bots&#x27; profiles<\/button>/, 'no second click while the first waits')
  assert.doesNotMatch(await render({ waitingAsks: 0 }), /Waiting for you/)
  assert.match(await render({ waitingAsks: 1 }), /1 ask is ready\./)
})

test("a bot's name on Performance opens its seat card, the same drawer as on the org chart", () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /<button type="button" className="text-button be-seat-link" onClick=\{\(\) => onOpen\(seat\.id\)\}>\{seat\.name\}<\/button>/, 'plain text with a line under it, never a button look')
  assert.match(workspace, /onOpen=\{setSelected\}/)
  assert.match(workspace, /\(view === 'org' \|\| view === 'work' \|\| view === 'performance'\) && chartSeat \? \(\s*<SeatDrawer/, 'the drawer renders on Performance too')
  assert.match(workspace, /className=\{\(view === 'org' \|\| view === 'work' \|\| view === 'performance'\) && chartSeat \? 'be-body be-with-panel' : 'be-body'\}/, 'and the page makes room for it')
  const css = readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.be-seat-link \{[^}]*border-radius: var\(--control-radius\)/, 'square, like every other corner')
})

test('Performance renders the status block above the table, from the sync status and the routine board', () => {
  const workspace = readFileSync(new URL('../../src/pages/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(workspace, /<PerformanceStatus\s/)
  assert.match(workspace, /waitingAsks=\{sync\?\.connector\?\.waiting\?\.profiles \?\? 0\}/)
  assert.match(workspace, /reported=\{[^}]*source === 'bot'[^}]*\}/)
  assert.doesNotMatch(workspace, /Skills counts the skills turned on for the bot in Grok Bot/, 'Grok Bot keeps no such setting')
  assert.match(workspace, /Skills counts the skills the bot reports it uses and the ones set on its profile here\./)
})
