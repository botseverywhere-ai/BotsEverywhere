import { useEffect, useMemo, useState } from 'react'
import { directoryHireState, type WriterProbe } from '../directory/hire-state'
import { CopyPromptButton, GrokBotLink } from '../directory/prompt-actions'
import { CORE_EVERYDAY, CORE_WORKCHART, DIRECTORY_CATEGORIES, toDirectoryEntry, type DirectoryBot, type DirectoryEntry } from '../directory/parse'
import { directoryIndex, loadDirectoryBot, type DirectoryCard } from '../directory/load'
import { APP_MODE } from '../mode'
import { SHOWCASE_NOTICE } from '../content/showcase-notice'
import { Button } from '../components/Button'

export function DirectoryPage({
  slug,
  sample,
  writer,
  takenSlugs,
  onHire,
}: {
  slug: string
  sample: boolean
  writer: WriterProbe
  takenSlugs: string[]
  onHire: (entry: DirectoryEntry) => void
}) {
  if (!slug) return <DirectoryIndex />
  return <BotRoute key={slug} slug={slug} sample={sample} writer={writer} takenSlugs={takenSlugs} onHire={onHire} />
}

function categoryFromHash(): string {
  const hash = window.location.hash
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const value = new URLSearchParams(query).get('category') ?? ''
  return (DIRECTORY_CATEGORIES as readonly string[]).includes(value) ? value : 'All'
}

function DirectoryIndex() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(categoryFromHash)
  const catalog = useMemo(
    () => directoryIndex.map((bot) => ({ bot, hay: `${bot.name} ${bot.summary} ${bot.category}`.toLowerCase() })),
    [],
  )
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return catalog
      .filter(({ bot, hay }) => {
        if (category !== 'All' && bot.category !== category) return false
        if (!needle) return true
        return hay.includes(needle)
      })
      .map(({ bot }) => bot)
  }, [catalog, query, category])
  const showCore = category === 'All' && query.trim() === ''
  const everyday = useMemo(
    () => CORE_EVERYDAY.map((slug) => directoryIndex.find((bot) => bot.slug === slug)).filter((bot): bot is DirectoryCard => Boolean(bot)),
    [],
  )
  const workChart = useMemo(
    () => CORE_WORKCHART.map((slug) => directoryIndex.find((bot) => bot.slug === slug)).filter((bot): bot is DirectoryCard => Boolean(bot)),
    [],
  )
  const listed = showCore ? visible.filter((bot) => !bot.core) : visible

  return (
    <section className="dir-page">
      <p className="dir-kicker">Bot directory</p>
      <h1>Bots for the work an organization already does</h1>
      <p className="dir-lede">
        Each bot is a prompt, a seat card, and a suggested trigger. Nothing here is rated, counted, or endorsed.
      </p>
      <div className="dir-tools">
        <div className="dir-search">
          <svg className="dir-search-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 12.5 15.5 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            placeholder="Search bots by name or job"
            aria-label="Search bots by name or job"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" className="dir-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M3 3l8 8M11 3 3 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="dir-filters" role="group" aria-label="Category">
          <Filter on={category === 'All'} onClick={() => setCategory('All')}>All</Filter>
          {DIRECTORY_CATEGORIES.map((item) => (
            <Filter key={item} on={category === item} onClick={() => setCategory(item)}>{item}</Filter>
          ))}
        </div>
      </div>
      {showCore ? (
        <>
          <section className="dir-start" aria-labelledby="dir-everyday-heading">
            <h2 id="dir-everyday-heading">Everyday bots</h2>
            <ul className="dir-start-row">
              {everyday.map((bot) => (
                <li key={bot.slug}>
                  <BotCard bot={bot} />
                </li>
              ))}
            </ul>
          </section>
          <section className="dir-start" aria-labelledby="dir-workchart-heading">
            <h2 id="dir-workchart-heading">Work chart bots</h2>
            <ul className="dir-start-row">
              {workChart.map((bot) => (
                <li key={bot.slug}>
                  <BotCard bot={bot} />
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      {listed.length === 0 ? <p className="dir-empty">No bots match that filter.</p> : null}
      <ul className="dir-grid">
        {listed.map((bot) => (
          <li key={bot.slug}>
            <BotCard bot={bot} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function BotRoute({
  slug,
  sample,
  writer,
  takenSlugs,
  onHire,
}: {
  slug: string
  sample: boolean
  writer: WriterProbe
  takenSlugs: string[]
  onHire: (entry: DirectoryEntry) => void
}) {
  const [bot, setBot] = useState<DirectoryBot | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancel = false
    loadDirectoryBot(slug).then((found) => {
      if (cancel) return
      if (!found) setMissing(true)
      else setBot(found)
    }).catch(() => {
      if (!cancel) setMissing(true)
    })
    return () => {
      cancel = true
    }
  }, [slug])
  if (missing) {
    return (
      <section className="dir-page">
        <p className="dir-kicker">Bot directory</p>
        <h1>That bot is not in the directory</h1>
        <p className="dir-lede">Check the link, or go back to the full list.</p>
        <p className="dir-actions">
          <Button variant="secondary"  href="#directory">All bots</Button>
        </p>
      </section>
    )
  }
  if (!bot) return <section className="dir-page"><p className="dir-empty">Loading this bot…</p></section>
  return <BotPage bot={bot} sample={sample} writer={writer} takenSlugs={takenSlugs} onHire={onHire} />
}

function BotPage({
  bot,
  sample,
  writer,
  takenSlugs,
  onHire,
}: {
  bot: DirectoryBot
  sample: boolean
  writer: WriterProbe
  takenSlugs: string[]
  onHire: (entry: DirectoryEntry) => void
}) {
  const [notice, setNotice] = useState('')
  const hire = directoryHireState({
    sample,
    writer,
    alreadySeated: takenSlugs.includes(bot.slug),
    name: bot.name,
  })
  return (
    <article className="dir-page dir-bot">
      <p className="dir-back">
        <Button variant="ghost" back  href="#directory">Back to all bots
        </Button>
      </p>
      <p className="dir-kicker">Bot directory</p>
      <h1>{bot.name}</h1>
      <p><span className="dir-pill">{bot.category}</span></p>
      <p className="dir-lede">{bot.summary}</p>
      <h2>The prompt</h2>
      <pre className="dir-prompt">{bot.prompt}</pre>
      <div className="dir-actions">
        <GrokBotLink url={bot.addToGrokBotUrl} />
        <CopyPromptButton text={bot.prompt} onCopied={setNotice} />
        {APP_MODE === 'showcase' ? (
          <Button variant="secondary" type="button"  onClick={() => setNotice(SHOWCASE_NOTICE)}>Hire into team</Button>
        ) : (
          <>
            <Button variant="secondary"
              type="button"
              
              disabled={!hire.enabled}
              onClick={() => onHire(toDirectoryEntry(bot))}
            >
              Hire into team
            </Button>
            {hire.reason ? <p className="dir-hire-reason" role="status">{hire.reason}</p> : null}
          </>
        )}
      </div>
      {notice ? <p className="toast show" role="status">{notice}</p> : null}
      <h2>How to use this prompt</h2>
      <ol className="dir-steps">
        <li>Copy the prompt.</li>
        <li>Paste it into a new Grok Bot.</li>
        <li>Review the first run.</li>
      </ol>
      <h2>Seat card</h2>
      <SeatBlock title="Owns" items={bot.owns} />
      <SeatBlock title="May" items={bot.may} />
      <SeatBlock title="Needs approval" items={bot.mustAskBefore} />
      <SeatBlock title="Done when" items={bot.doneWhen} />
      <h2>Suggested work-chart trigger</h2>
      <p className="dir-trigger">{bot.trigger}</p>
    </article>
  )
}

function BotCard({ bot }: { bot: DirectoryCard }) {
  return (
    <article className={bot.addToGrokBotUrl ? 'dir-card has-add' : 'dir-card'}>
      <a className="dir-card-link" href={`#/directory/${bot.slug}`}>
        <span className="dir-pill">{bot.category}</span>
        <h2>{bot.name}</h2>
        <p>{bot.summary}</p>
      </a>
      <GrokBotLink url={bot.addToGrokBotUrl} label="Add" />
    </article>
  )
}

function SeatBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="dir-seat">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  )
}

function Filter({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <Button variant={on ? "primary" : "secondary"} type="button"  aria-pressed={on} onClick={onClick}>
      {children}
    </Button>
  )
}
