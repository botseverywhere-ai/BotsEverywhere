import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Seat } from '../data/mock-companies'
import { isGrokBotUrl, isSeatGrokLink } from '../../server/src/org-files.ts'
import { displayCardText } from '../preview/card-text'
import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { Button } from './Button'
import { SaveAlert } from './SaveAlert'
import type { SeatDrawerTab } from './seat-drawer-tab'
import { grokRequestLine, grokSyncClass, grokSyncLine, grokSyncTag } from './sync-copy'

export interface DirectoryProfileView {
  category: string
  summary: string
  prompt: string
}

export function SeatDrawer({
  seat,
  reportsTo,
  tab,
  least,
  fading,
  sample,
  allowRetire = true,
  allowRetireHuman = false,
  directorySlug = '',
  directoryProfile,
  cardSave = null,
  onCardCommit,
  managers,
  onReportsTo,
  onTab,
  onClose,
  onRetire,
  onGrokUrl,
  onCard,
  onEditAttempt,
  grokRequestedAt = '',
  onCreateInGrok,
  children,
}: {
  seat: Seat
  reportsTo?: string
  /** Seats this one may report to. With onReportsTo, the manager line becomes a select. */
  managers?: { slug: string; title: string }[]
  onReportsTo?: (slug: string) => void
  tab: SeatDrawerTab
  least: boolean
  fading: boolean
  sample: boolean
  allowRetire?: boolean
  /** People can be retired too, when the org keeps another person. */
  allowRetireHuman?: boolean
  /** Directory slug for this bot. The profile tab loads that prompt when it opens. */
  directorySlug?: string
  /** Set by tests and callers that already have the directory text. */
  directoryProfile?: DirectoryProfileView | null
  cardSave?: { state: 'saving' | 'saved' | 'error'; message: string } | null
  onCardCommit?: () => void
  onTab: (tab: SeatDrawerTab) => void
  onClose: () => void
  onRetire?: () => void
  onGrokUrl?: (url: string) => void
  onCard?: (card: Seat['card']) => void
  onEditAttempt?: () => void
  /** When the app last asked the Connector to create this bot, or ''. */
  grokRequestedAt?: string
  /** Writes a request the Connector reads on its next run. */
  onCreateInGrok?: () => void
  children?: ReactNode
}) {
  return (
    <aside className={fading ? 'panel preview-drawer fading' : 'panel preview-drawer'} aria-labelledby="panel-title">
      <div className="drawer-head">
        <h2 id="panel-title">{seat.name}</h2>
        <Button variant="secondary" type="button" className="drawer-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4 4 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Button>
      </div>
      <p className="reports">
        {seat.role} · <span className={`type-mark type-${seat.type}`}>{seat.type}</span>
        {least ? <span className="least-tag">Least used</span> : null}
      </p>
      {managers && onReportsTo && seat.reportsTo ? (
        <label className="field-label reports">
          Reports to
          <select className="text-input" value={seat.reportsTo} onChange={(event) => onReportsTo(event.target.value)}>
            {managers.some((item) => item.slug === seat.reportsTo) ? null : (
              <option value={seat.reportsTo} disabled>{reportsTo || seat.reportsTo} (retired)</option>
            )}
            {managers.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
          </select>
        </label>
      ) : (
        <p className="reports">{reportsTo ? `Reports to ${reportsTo}` : 'Top of the chart'}</p>
      )}
      {onCreateInGrok && seat.type === 'bot' && grokSyncClass(seat) !== 'is-in-grok' ? (
        <section className="grok-create" aria-label="Grok Bot">
          <p className="grok-create-state"><strong>{grokSyncTag(seat)}</strong> · {grokSyncLine(seat)}</p>
          {grokRequestedAt ? <p className="auth-note">{grokRequestLine(grokRequestedAt)}</p> : (
            <Button variant="primary" type="button" onClick={onCreateInGrok}>Create in Grok Bot</Button>
          )}
        </section>
      ) : null}
      <div className="toggle drawer-tabs" role="tablist" aria-label="Seat">
        {(['card', 'performance', 'profile'] as const).map((item) => (
          <button key={item} type="button" role="tab" className={tab === item ? 'active' : undefined} aria-selected={tab === item} onClick={() => onTab(item)}>
            {item === 'card' ? 'Seat card' : item === 'performance' ? 'Performance' : 'Profile'}
          </button>
        ))}
      </div>
      {cardSave?.state === 'saving' ? <p className="auth-note" role="status">{cardSave.message}</p> : null}
      {cardSave && cardSave.state !== 'saving' ? <SaveAlert kind={cardSave.state === 'saved' ? 'ok' : 'bad'}>{cardSave.message}</SaveAlert> : null}
      {tab === 'card' && onCard ? (
        <>
          <CardEditor title="Owns" items={seat.card.owns} grow onChange={(owns) => onCard({ ...seat.card, owns })} onBlur={onCardCommit} hint={cardHint(seat, seat.card.owns, 'Owns')} />
          <CardEditor title="May" items={seat.card.may} onChange={(may) => onCard({ ...seat.card, may })} onBlur={onCardCommit} hint={cardHint(seat, seat.card.may, 'May')} />
          <CardEditor title="Needs approval" items={seat.card.mustAskBefore} onChange={(mustAskBefore) => onCard({ ...seat.card, mustAskBefore })} onBlur={onCardCommit} hint={cardHint(seat, seat.card.mustAskBefore, 'Needs approval')} />
          <CardEditor title="Done when" items={seat.card.doneWhen} onChange={(doneWhen) => onCard({ ...seat.card, doneWhen })} onBlur={onCardCommit} hint={cardHint(seat, seat.card.doneWhen, 'Done when')} />
          <RoutineList routines={seat.routines} />
        </>
      ) : null}
      {tab === 'card' && !onCard ? (
        <>
          <CardList title="Owns" items={seat.card.owns} />
          <CardList title="May" items={seat.card.may} />
          <CardList title="Needs approval" items={seat.card.mustAskBefore} />
          <CardList title="Done when" items={seat.card.doneWhen} />
          <RoutineList routines={seat.routines} />
          {onEditAttempt ? (
            <Button variant="secondary" type="button"  onClick={onEditAttempt}>Edit seat</Button>
          ) : null}
        </>
      ) : null}
      {tab === 'performance' ? (
        seat.type === 'bot' ? (
          <dl className="stat-list">
            <div><dt>Created</dt><dd>{formatShortDate(seat.shown?.createdAt || seat.createdAt || '')}</dd></div>
            <div><dt>Times used (30d)</dt><dd>{formatCount(seat.shown ? seat.shown.usage : seat.runs30d ?? seat.stats?.usageCount30d)}{sample ? <span className="usage-sample">sample</span> : null}</dd></div>
            <div><dt>Automated tasks done (30d)</dt><dd>{formatCount(seat.shown ? seat.shown.tasks : seat.importedTasks30d ?? seat.stats?.tasksDone30d)}{sample ? <span className="usage-sample">sample</span> : null}</dd></div>
            <div><dt>Last active</dt><dd>{formatShortDate(seat.shown?.lastActive || seat.importedLastActive || (seat.shown || seat.importedLastActive ? '' : seat.stats?.lastActiveAt || ''))}{sample ? <span className="usage-sample">sample</span> : null}</dd></div>
            <div><dt>Status</dt><dd>{seat.status === 'retired' ? 'Retired' : 'Active'}</dd></div>
            <div><dt>Grok Bot</dt><dd>{grokSyncLine(seat)}</dd></div>
          </dl>
        ) : (
          <p className="auth-note">Performance is tracked for bots.</p>
        )
      ) : null}
      {tab === 'profile' && seat.type === 'bot' ? (
        directoryProfile ? (
          <DirectoryProfileBody profile={directoryProfile} />
        ) : directoryProfile === null || !directorySlug ? (
          <p className="auth-note">This seat is not in the directory.</p>
        ) : (
          <DirectoryProfile slug={directorySlug} />
        )
      ) : null}
      {tab === 'profile' && seat.type !== 'bot' && seat.profile ? (
        <dl className="stat-list">
          <div><dt>Department</dt><dd>{seat.profile.department || '—'}</dd></div>
          <div><dt>Location</dt><dd>{seat.profile.location || '—'}</dd></div>
          <div><dt>Email</dt><dd>{seat.profile.email || '—'}</dd></div>
          <div><dt>Phone</dt><dd>{seat.profile.phone || '—'}</dd></div>
          <div><dt>Started</dt><dd>{seat.profile.startedOn || '—'}</dd></div>
          <div><dt>About</dt><dd>{seat.profile.bio}</dd></div>
        </dl>
      ) : null}
      {tab === 'card' ? children : null}
      <OpenGrokBot url={seat.grokBotUrl} />
      <GrokActions url={seat.addToGrokBotUrl || seat.grokShareUrl} onUrl={onGrokUrl} />
      {allowRetire && (seat.type === 'bot' || (allowRetireHuman && seat.type === 'human')) && seat.status !== 'retired' && onRetire ? (
        <Button variant="primary" type="button"  onClick={onRetire}>
          Retire…
        </Button>
      ) : null}
    </aside>
  )
}

function formatCount(value: number | null | undefined): string | number {
  return value === undefined || value === null ? '—' : value
}

function RoutineList({ routines }: { routines?: { name: string; schedule: string; lastRun?: string }[] }) {
  if (!routines?.length) return null
  const label = routines.length === 1 ? '1 routine' : `${routines.length} routines`
  return (
    <section className="seat-routines">
      <h3 className="card-label">{label}</h3>
      <ul>
        {routines.map((routine) => (
          <li key={`${routine.name}-${routine.schedule}`}>
            <strong>{routine.name}</strong>
            {routine.schedule ? ` · ${routine.schedule}` : ''}
            {routine.lastRun ? ` · ${formatShortDate(routine.lastRun)}` : ''}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DirectoryProfile({ slug }: { slug: string }) {
  const [profile, setProfile] = useState<DirectoryProfileView | null | undefined>(undefined)
  useEffect(() => {
    let cancel = false
    import('../directory/load').then((mod) => mod.loadDirectoryBot(slug)).then((bot) => {
      if (cancel) return
      setProfile(bot ? { category: bot.category, summary: bot.summary, prompt: bot.prompt } : null)
    }).catch(() => {
      if (!cancel) setProfile(null)
    })
    return () => {
      cancel = true
    }
  }, [slug])
  if (profile === undefined) return <p className="auth-note">Loading the directory profile…</p>
  if (!profile) return <p className="auth-note">This seat is not in the directory.</p>
  return <DirectoryProfileBody profile={profile} />
}

function DirectoryProfileBody({ profile }: { profile: DirectoryProfileView }) {
  return (
    <>
      <p><span className="dir-pill">{profile.category}</span></p>
      <p>{profile.summary}</p>
      <h3 className="card-label">Prompt</h3>
      <pre className="dir-prompt">{profile.prompt}</pre>
    </>
  )
}

function OpenGrokBot({ url }: { url?: string | null }) {
  const link = url && isSeatGrokLink(url) && url.trim() ? url.trim() : ''
  if (!link) return null
  return (
    <div className="grok-soon">
      <Button variant="primary" href={link} target="_blank" rel="noreferrer">
        Open in Grok Bot
      </Button>
    </div>
  )
}

function GrokActions({ url, onUrl }: { url?: string | null; onUrl?: (url: string) => void }) {
  const link = url && isGrokBotUrl(url) && url ? url : ''
  if (!link && !onUrl) return null
  return (
    <div className="grok-soon">
      {link ? (
        <Button variant="primary"  href={link} target="_blank" rel="noreferrer">
          Add to Grok Bot
        </Button>
      ) : null}
      {onUrl ? (
        <>
          <p className="auth-note">Paste your Grok Bot share link (x.ai/bot/...) to enable this button.</p>
          <label className="field-label">
            addToGrokBotUrl
            <input className="text-input" value={url ?? ''} placeholder="https://x.ai/bot/…" onChange={(event) => onUrl(event.target.value.trim())} />
          </label>
          {url && !isGrokBotUrl(url) ? <p className="form-error">Use an empty value or https://x.ai/bot/…</p> : null}
        </>
      ) : null}
    </div>
  )
}

const EMPTY_HINT: Record<string, string> = {
  Owns: 'Empty. Add what this bot owns.',
  May: 'Empty. Add what this bot may do.',
  'Needs approval': 'Empty. Add what this bot must ask before doing.',
  'Done when': 'Empty. Add when this bot is done.',
}

function cardHint(seat: Seat, items: string[], section: string): string {
  if (seat.type !== 'bot' || seat.status === 'retired') return ''
  if (items.some((line) => line.trim())) return ''
  return EMPTY_HINT[section] ?? 'Empty. Add a line for this field.'
}

function CardEditor({
  title,
  items,
  onChange,
  onBlur,
  hint,
  grow = false,
}: {
  title: string
  items: string[]
  onChange: (items: string[]) => void
  onBlur?: () => void
  hint?: string
  grow?: boolean
}) {
  const id = useId()
  return (
    <div className="card-field">
      <label className="field-label" htmlFor={id}>{title}</label>
      {grow ? (
        <OwnsField id={id} items={items} onChange={onChange} onBlur={onBlur} />
      ) : (
        <textarea id={id} className="text-input" rows={4} value={items.join('\n')} onChange={(event) => onChange(event.target.value.split('\n'))} onBlur={onBlur} />
      )}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

function OwnsField({
  id,
  items,
  onChange,
  onBlur,
}: {
  id: string
  items: string[]
  onChange: (items: string[]) => void
  onBlur?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const value = items.join('\n')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + border}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      id={id}
      className="text-input card-owns"
      rows={2}
      value={value}
      onChange={(event) => onChange(event.target.value.split('\n'))}
      onBlur={onBlur}
    />
  )
}

function CardList({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <h3 className="card-label">{title}</h3>
      {items.length ? (
        <ul className="card-points">
          {items.map((item) => (
            <li key={item}>{displayCardText(item)}</li>
          ))}
        </ul>
      ) : (
        <p className="auth-note">Not on the seat card yet.</p>
      )}
    </>
  )
}
