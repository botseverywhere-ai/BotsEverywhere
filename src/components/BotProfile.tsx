import { useEffect, useId, useState } from 'react'
import type { Seat } from '../data/mock-companies'
import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { ROUTINE_STARTS, type BotRoutine, type BotSkill, type RoutineStart } from '../../server/src/org-files.ts'
import type { AccountApp } from '../../server/src/grok-sync.ts'
import type { AppUse } from '../../server/src/routine-board-types.ts'
import { connectedApps, NEEDS_SIGN_IN } from '../org/bot-apps'
import { skillsInGrok } from '../org/bot-skills'
import { AccountApps } from './AccountApps'
import { Button } from './Button'
import { grokRequestLine, grokSyncTag } from './sync-copy'
import { CRON_PRESETS, IMPORTED_NOTE, IMPORTED_TITLE, SKILLS_HINT, UPDATE_HINT, UPDATE_LABEL, updateWaitingLine, INSTRUCTIONS_LABEL, INSTRUCTIONS_PLACEHOLDER, START_LABELS, cronText, draftRoutines, draftRows, keptSkills, profileParts, promptToSave, startLine } from './bot-profile-copy'

type Skill = { name: string; description?: string }

export interface ProfileChanges {
  instructions?: string
  skills?: Skill[]
  routines?: BotRoutine[]
}

/**
 * Profile on an organization of your own: how the bot works. A directory bot's prompt and a hand-added bot's
 * instructions are edited here; an imported bot's skills and routines come from Grok Bot and are only shown.
 */
export function BotProfile({ seat, grokRequestedAt, grokUpdateAt = '', grokUpdateItems = [], accountApps, reportedSkills, reportedApps, onProfile, onCreateInGrok, onUpdateInGrok }: {
  seat: Seat
  grokRequestedAt: string
  /** Apps connected to the Grok Bot account, for each app's status. */
  accountApps?: AccountApp[]
  /** Skills in Grok Bot for this bot, from the Connector's reading: saved in the library and named in its instructions. Absent until the Connector shows them. */
  reportedSkills?: BotSkill[]
  /** Apps this bot says it uses, from its own profile. Absent until it reports them. */
  reportedApps?: AppUse[]
  grokUpdateAt?: string
  /** The waiting update's changes, one per line. A move waits as an update too, so Update bot stays to add skills and routines to it. */
  grokUpdateItems?: string[]
  onProfile: (changes: ProfileChanges) => void
  onCreateInGrok?: () => void
  onUpdateInGrok?: () => void
}) {
  const parts = profileParts(seat)
  const directory = useDirectoryPrompt(parts.prompt === 'directory' ? seat.directoryId ?? '' : '')
  const promptId = useId()
  const [prompt, setPrompt] = useState<string | null>(null)
  const directoryText = directory?.prompt ?? ''
  const shownPrompt = prompt ?? seat.instructions ?? (parts.prompt === 'directory' ? directoryText : '')
  const savePrompt = () => {
    if (prompt === null) return
    onProfile({ instructions: parts.prompt === 'directory' ? promptToSave(prompt, directoryText) : prompt.trim() })
  }

  return (
    <div className="bot-profile">
      {parts.note ? (
        <div className="profile-origin" role="note">
          <strong>{IMPORTED_TITLE}</strong>
          <p>{IMPORTED_NOTE}</p>
        </div>
      ) : null}
      {parts.prompt === 'directory' && directory === undefined ? <p className="auth-note">Loading the directory profile…</p> : null}
      {parts.prompt === 'directory' && directory !== undefined ? (
        <>
          {directory ? <p><span className="dir-pill">{directory.category}</span></p> : null}
          {directory ? <p>{directory.summary}</p> : null}
          <div className="card-field">
            <label className="field-label" htmlFor={promptId}>Prompt</label>
            <textarea id={promptId} className="text-input bot-prompt" rows={10} value={shownPrompt} onChange={(event) => setPrompt(event.target.value)} onBlur={savePrompt} />
            <p className="field-hint">Grok Bot gets this prompt when the bot is added there.</p>
          </div>
        </>
      ) : null}
      {parts.prompt === 'instructions' ? (
        <>
          <p className="grok-create-state"><strong>{parts.addToGrok ? 'Not in Grok Bot' : grokSyncTag({ grokSync: seat.grokSync, grokBotUrl: seat.grokBotUrl ?? '' })}</strong></p>
          <div className="card-field">
            <label className="field-label" htmlFor={promptId}>{INSTRUCTIONS_LABEL}</label>
            <textarea id={promptId} className="text-input bot-prompt" rows={6} placeholder={INSTRUCTIONS_PLACEHOLDER} value={shownPrompt} onChange={(event) => setPrompt(event.target.value)} onBlur={savePrompt} />
          </div>
        </>
      ) : null}
      {parts.listsEditable ? (
        <>
          <SkillEditor initial={seat.skills ?? []} inGrok={reportedSkills} onSave={(skills) => onProfile({ skills: draftRows(skills) })} />
          <RoutineEditor initial={seat.routines ?? []} onSave={(routines) => onProfile({ routines: draftRoutines(routines) })} />
          <AppList account={accountApps} used={reportedApps} />
          {!parts.addToGrok && onUpdateInGrok ? (
            <section className="profile-update">
              {grokUpdateAt ? (
                <>
                  <p className="grok-create-state be-connecting">{grokUpdateItems.length ? null : <i className="be-pulse" aria-hidden="true" />}<strong>Update waiting for the Connector</strong></p>
                  <p className="auth-note">{updateWaitingLine(grokUpdateAt, grokUpdateItems.length)}</p>
                  {grokUpdateItems.length ? <ul className="profile-update-items">{grokUpdateItems.map((item, index) => <li key={index}><i className="be-pulse" aria-hidden="true" />{item}</li>)}</ul> : null}
                </>
              ) : null}
              <Button variant="primary" type="button" onClick={onUpdateInGrok}>{UPDATE_LABEL}</Button>
              <p className="field-hint">{UPDATE_HINT}</p>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <ProfileLists seat={seat} inGrok={reportedSkills} />
          <AppList account={accountApps} used={reportedApps} />
        </>
      )}
      {seat.publicUrl ? (
        <Button variant="secondary" href={seat.publicUrl} target="_blank" rel="noreferrer">Get this bot</Button>
      ) : null}
      {parts.addToGrok && onCreateInGrok ? (
        grokRequestedAt ? (
          <>
            <p className="grok-create-state be-connecting"><i className="be-pulse" aria-hidden="true" /><strong>Connecting to Grok Bot</strong></p>
            <p className="auth-note">{grokRequestLine(grokRequestedAt)}</p>
          </>
        ) : (
          <Button variant="primary" type="button" onClick={onCreateInGrok}>Add to Grok Bot</Button>
        )
      ) : null}
    </div>
  )
}

/**
 * The apps this bot says it uses, and what for, read only. Apps belong to the whole Grok Bot account, so every bot can
 * use each one: the account's apps follow on one line.
 */
export function AppList({ account, used }: { account?: AccountApp[]; used?: AppUse[] }) {
  const connected = connectedApps(account)
  const status = new Map(connected.map((app) => [app.name.toLowerCase(), app.status]))
  return (
    <section className="profile-list">
      <h3 className="card-label">Apps used</h3>
      {used?.length ? (
        <ul>
          {used.map((app) => (
            <li key={app.name}>
              <strong>{app.name}</strong>
              {status.get(app.name.toLowerCase()) === 'needsAuth' ? <span className="app-needs-auth">{NEEDS_SIGN_IN}</span> : null}
              {app.use ? <span className="profile-line">{app.use}</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="auth-note">{used ? 'The bot says it uses none of the connected apps.' : 'Not reported yet. The bot lists the apps it uses when it sends its profile.'}</p>}
      <AccountApps apps={account} />
    </section>
  )
}

/** Skills, read only: each one's name and what it does. */
function SkillItems({ skills }: { skills: BotSkill[] }) {
  return (
    <ul>
      {skills.map((skill) => (
        <li key={skill.name}><strong>{skill.name}</strong>{skill.description ? <span className="profile-line">{skill.description}</span> : null}</li>
      ))}
    </ul>
  )
}

/**
 * Skills and routines, read only: an imported bot's, and every bot's on a template. The skills include the ones the bot
 * reported turned on in Grok Bot.
 */
export function ProfileLists({ seat, inGrok }: { seat: Pick<Seat, 'skills' | 'routines'>; inGrok?: BotSkill[] }) {
  const skills = [...(seat.skills ?? []), ...skillsInGrok(inGrok, seat.skills)]
  return (
    <>
      <section className="profile-list">
        <h3 className="card-label">Skills</h3>
        {skills.length ? <SkillItems skills={skills} /> : <p className="auth-note">No skills yet.</p>}
      </section>
      <section className="profile-list">
        <h3 className="card-label">Routines</h3>
        {seat.routines?.length ? (
          <ul>
            {seat.routines.map((routine) => (
              <li key={`${routine.name}-${routine.schedule}`}>
                <strong>{routine.name}</strong>
                {routine.enabled === false ? <span className="routine-paused">Paused</span> : null}
                {startLine(routine) ? <span className="profile-line">{startLine(routine)}</span> : null}
                {routine.description ? <span className="profile-line">{routine.description}</span> : null}
                {routine.lastRun ? <span className="profile-line">Last run {formatShortDate(routine.lastRun)}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="auth-note">No routines yet.</p>}
      </section>
    </>
  )
}

/**
 * One list of the bot's skills. A skill the bot has in Grok Bot is locked, as a bot is once it exists there: shown with
 * its name and what it does, removed only in Grok Bot. `inGrok` is the Connector's reading: the skills saved in the
 * library and named in this bot's instructions. A skill added here is a name and what it does with a remove button,
 * until the Connector has carried it there. The seat keeps every locked skill it added, so its block still names it.
 */
function SkillEditor({ initial, inGrok, onSave }: { initial: Skill[]; inGrok?: BotSkill[]; onSave: (skills: Skill[]) => void }) {
  const [skills, setSkills] = useState<Skill[]>(initial)
  const update = (index: number, change: Partial<Skill>) => setSkills(skills.map((skill, at) => (at === index ? { ...skill, ...change } : skill)))
  const key = (name: string) => name.trim().toLowerCase()
  const reported = inGrok ?? []
  const isLocked = (skill: Skill) => Boolean(key(skill.name)) && reported.some((item) => key(item.name) === key(skill.name))
  const describe = (skill: Skill) => skill.description || reported.find((item) => key(item.name) === key(skill.name))?.description || ''
  const locked = [...skills.filter(isLocked), ...skillsInGrok(inGrok, skills)]
  return (
    <section className="profile-list">
      <h3 className="card-label">Skills</h3>
      <p className="field-hint">{SKILLS_HINT}</p>
      {skills.length === 0 && !locked.length ? <p className="auth-note">No skills yet.</p> : null}
      {locked.length ? (
        <ul className="profile-items">
          {locked.map((skill) => (
            <li className="skill-locked" key={skill.name}><strong>{skill.name}</strong><span className="connect-badge is-connected"><i aria-hidden="true" />In Grok Bot</span>{describe(skill) ? <span className="profile-line">{describe(skill)}</span> : null}</li>
          ))}
        </ul>
      ) : null}
      {skills.map((skill, index) => isLocked(skill) ? null : (
        <div className="skill-row" key={index}>
          <div className="skill-fields">
            <input className="text-input" aria-label="Skill name" placeholder="New skill" value={skill.name} onChange={(event) => update(index, { name: event.target.value })} onBlur={() => onSave(skills)} />
            <input className="text-input" aria-label="What the skill does" placeholder="What it does (optional)" value={skill.description ?? ''} onChange={(event) => update(index, { description: event.target.value })} onBlur={() => onSave(skills)} />
          </div>
          <Button variant="ghost" type="button" className="icon-btn" aria-label="Remove skill" onClick={() => { const next = keptSkills(skills, reported.map((item) => item.name), index); setSkills(next); onSave(next) }}>
            <TrashIcon />
          </Button>
        </div>
      ))}
      <Button variant="secondary" type="button" onClick={() => setSkills([...skills, { name: '', description: '' }])}>+ Add skill</Button>
    </section>
  )
}

const NEW_ROUTINE: BotRoutine = { name: '', schedule: '0 9 * * 1-5', trigger: 'schedule', description: '', timeZone: '', event: '' }

/** Routines as the Grok Bot Graph panel edits them: a card per routine, open while it is edited, closed with Done. */
function RoutineEditor({ initial, onSave }: { initial: BotRoutine[]; onSave: (routines: BotRoutine[]) => void }) {
  const [routines, setRoutines] = useState<BotRoutine[]>(initial)
  const [open, setOpen] = useState<number | null>(null)
  const change = (index: number, patch: Partial<BotRoutine>, save = false) => {
    const next = routines.map((routine, at) => (at === index ? { ...routine, ...patch } : routine))
    setRoutines(next)
    if (save) onSave(next)
  }
  const remove = (index: number) => {
    const next = routines.filter((_, at) => at !== index)
    setRoutines(next)
    setOpen(null)
    onSave(next)
  }
  return (
    <section className="profile-list">
      <h3 className="card-label">Routines</h3>
      <p className="field-hint">Work this bot starts on its own, on a schedule or after an event.</p>
      {routines.map((routine, index) => (
        open === index ? (
          <RoutineForm
            key={index}
            routine={routine}
            onChange={(patch, save) => change(index, patch, save)}
            onBlur={() => onSave(routines)}
            onRemove={() => remove(index)}
            onDone={() => { setOpen(null); onSave(routines) }}
          />
        ) : (
          <div className="routine-card is-closed" key={index}>
            <div>
              <strong>{routine.name || 'New routine'}</strong>
              {routine.enabled === false ? <span className="routine-paused">Paused</span> : null}
              {startLine(routine) ? <span className="profile-line">{startLine(routine)}</span> : null}
              {routine.description ? <span className="profile-line">{routine.description}</span> : null}
            </div>
            <Button variant="ghost" type="button" onClick={() => setOpen(index)}>Edit</Button>
          </div>
        )
      ))}
      <Button variant="secondary" type="button" onClick={() => { setRoutines([...routines, { ...NEW_ROUTINE }]); setOpen(routines.length) }}>+ Add routine</Button>
    </section>
  )
}

function RoutineForm({ routine, onChange, onBlur, onRemove, onDone }: {
  routine: BotRoutine
  onChange: (patch: Partial<BotRoutine>, save?: boolean) => void
  onBlur: () => void
  onRemove: () => void
  onDone: () => void
}) {
  const start: RoutineStart = routine.trigger ?? 'schedule'
  const words = start === 'schedule' ? cronText(routine.schedule) : ''
  const zones = routine.timeZone && !TIME_ZONES.includes(routine.timeZone) ? [routine.timeZone, ...TIME_ZONES] : TIME_ZONES
  return (
    <div className="routine-card">
      <label className="routine-field">
        <span className="field-label">Name</span>
        <input className="text-input" placeholder="New routine" value={routine.name} onChange={(event) => onChange({ name: event.target.value })} onBlur={onBlur} />
      </label>
      <label className="routine-field">
        <span className="field-label">Description</span>
        <textarea className="text-input" rows={3} placeholder="What it does and what it delivers (optional)" value={routine.description ?? ''} onChange={(event) => onChange({ description: event.target.value })} onBlur={onBlur} />
      </label>
      <p className="field-hint">Keep the instructions in Grok Bot. Only the outline is saved here.</p>
      <label className="routine-field">
        <span className="field-label">Starts</span>
        <select className="text-input" value={start} onChange={(event) => onChange({ trigger: event.target.value as RoutineStart }, true)}>
          {ROUTINE_STARTS.map((item) => <option key={item} value={item}>{START_LABELS[item]}</option>)}
        </select>
      </label>
      {start === 'schedule' ? (
        <>
          <div className="routine-field">
            <span className="field-label">Schedule</span>
            <div className="cron-row">
              <input className="text-input" aria-label="Schedule" placeholder="0 9 * * 1-5" value={routine.schedule} onChange={(event) => onChange({ schedule: event.target.value })} onBlur={onBlur} />
              <select className="text-input" aria-label="Presets" value="" onChange={(event) => { if (event.target.value) onChange({ schedule: event.target.value }, true) }}>
                <option value="">Presets</option>
                {CRON_PRESETS.map((preset) => <option key={preset.cron} value={preset.cron}>{preset.label}</option>)}
              </select>
            </div>
            {words ? <p className="field-hint">{words}</p> : null}
          </div>
          <label className="routine-field">
            <span className="field-label">Time zone</span>
            <select className="text-input" value={routine.timeZone ?? ''} onChange={(event) => onChange({ timeZone: event.target.value }, true)}>
              <option value="">Bot timezone</option>
              {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </label>
          <p className="field-hint">Empty uses the bot timezone from Grok Bot settings.</p>
        </>
      ) : (
        <>
          <label className="routine-field">
            <span className="field-label">Event</span>
            <input className="text-input" placeholder="A short rule, like Mentions in #support" value={routine.event ?? ''} onChange={(event) => onChange({ event: event.target.value })} onBlur={onBlur} />
          </label>
          <p className="field-hint">Leave out tokens and private links.</p>
        </>
      )}
      <label className="routine-active">
        <input type="checkbox" checked={routine.enabled !== false} onChange={(event) => onChange({ enabled: event.target.checked }, true)} />
        <span>Active</span>
      </label>
      <p className="field-hint">Turn off for routines paused in Grok Bot.</p>
      <div className="routine-actions">
        <Button variant="ghost" type="button" onClick={onRemove}>Remove</Button>
        <Button variant="secondary" type="button" onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}

/** Every IANA time zone this browser knows, or a short list where it cannot say. */
const TIME_ZONES: string[] = (() => {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone')
    if (list?.length) return list
  } catch {
    // Fall through to the short list.
  }
  return ['UTC', 'Europe/London', 'Europe/Madrid', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo']
})()

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5M7 7v4M9 7v4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The directory entry's text: undefined while it loads, null when the bot is not in the directory. */
function useDirectoryPrompt(slug: string): { category: string; summary: string; prompt: string } | null | undefined {
  const [found, setFound] = useState<{ slug: string; bot: { category: string; summary: string; prompt: string } | null } | null>(null)
  useEffect(() => {
    if (!slug) return
    let cancel = false
    import('../directory/load').then((mod) => mod.loadDirectoryBot(slug)).then((bot) => {
      if (!cancel) setFound({ slug, bot: bot ? { category: bot.category, summary: bot.summary, prompt: bot.prompt } : null })
    }).catch(() => {
      if (!cancel) setFound({ slug, bot: null })
    })
    return () => {
      cancel = true
    }
  }, [slug])
  if (!slug) return null
  return found && found.slug === slug ? found.bot : undefined
}
