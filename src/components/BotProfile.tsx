import { useEffect, useId, useState } from 'react'
import type { Seat } from '../data/mock-companies'
import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { Button } from './Button'
import { grokRequestLine, grokSyncTag } from './sync-copy'
import { IMPORTED_NOTE, INSTRUCTIONS_LABEL, INSTRUCTIONS_PLACEHOLDER, draftRows, profileParts, promptToSave } from './bot-profile-copy'

type Skill = { name: string; description?: string }
type Routine = { name: string; schedule: string; lastRun?: string; description?: string }

export interface ProfileChanges {
  instructions?: string
  skills?: Skill[]
  routines?: Routine[]
}

/**
 * Profile on an organization of your own: how the bot works. A directory bot's prompt and a hand-added bot's
 * instructions are edited here; an imported bot's skills and routines come from Grok Bot and are only shown.
 */
export function BotProfile({ seat, grokRequestedAt, onProfile, onCreateInGrok }: {
  seat: Seat
  grokRequestedAt: string
  onProfile: (changes: ProfileChanges) => void
  onCreateInGrok?: () => void
}) {
  const parts = profileParts(seat)
  const directory = useDirectoryPrompt(parts.prompt === 'directory' ? seat.directoryId ?? '' : '')
  const promptId = useId()
  const [prompt, setPrompt] = useState<string | null>(null)
  const [skills, setSkills] = useState<Skill[]>(() => seat.skills ?? [])
  const [routines, setRoutines] = useState<Routine[]>(() => seat.routines ?? [])
  const directoryText = directory?.prompt ?? ''
  const shownPrompt = prompt ?? seat.instructions ?? (parts.prompt === 'directory' ? directoryText : '')
  const savePrompt = () => {
    if (prompt === null) return
    onProfile({ instructions: parts.prompt === 'directory' ? promptToSave(prompt, directoryText) : prompt.trim() })
  }
  const saveSkills = (next: Skill[]) => onProfile({ skills: draftRows(next) })
  const saveRoutines = (next: Routine[]) => onProfile({ routines: draftRows(next) })

  return (
    <div className="bot-profile">
      {parts.note ? <p className="auth-note">{IMPORTED_NOTE}</p> : null}
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
          <RowEditor
            title="Skills"
            rows={skills}
            fields={[{ key: 'name', placeholder: 'Skill name' }, { key: 'description', placeholder: 'What it does' }]}
            addLabel="+ Add skill"
            blank={{ name: '', description: '' }}
            onChange={setSkills}
            onSave={saveSkills}
          />
          <RowEditor
            title="Routines"
            rows={routines}
            fields={[{ key: 'name', placeholder: 'Routine name' }, { key: 'schedule', placeholder: 'When it runs, like Weekdays 09:00' }, { key: 'description', placeholder: 'What it does' }]}
            addLabel="+ Add routine"
            blank={{ name: '', schedule: '', description: '' }}
            onChange={setRoutines}
            onSave={saveRoutines}
          />
        </>
      ) : (
        <ProfileLists seat={seat} />
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

/** Skills and routines, read only: an imported bot's, and every bot's on a template. */
export function ProfileLists({ seat }: { seat: Pick<Seat, 'skills' | 'routines'> }) {
  return (
    <>
      <section className="profile-list">
        <h3 className="card-label">Skills</h3>
        {seat.skills?.length ? (
          <ul>
            {seat.skills.map((skill) => (
              <li key={skill.name}><strong>{skill.name}</strong>{skill.description ? <span className="profile-line">{skill.description}</span> : null}</li>
            ))}
          </ul>
        ) : <p className="auth-note">No skills yet.</p>}
      </section>
      <section className="profile-list">
        <h3 className="card-label">Routines</h3>
        {seat.routines?.length ? (
          <ul>
            {seat.routines.map((routine) => (
              <li key={`${routine.name}-${routine.schedule}`}>
                <strong>{routine.name}</strong>
                {routine.schedule ? ` · ${routine.schedule}` : ''}
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

function RowEditor<T extends { name: string }>({ title, rows, fields, addLabel, blank, onChange, onSave }: {
  title: string
  rows: T[]
  fields: { key: keyof T & string; placeholder: string }[]
  addLabel: string
  blank: T
  onChange: (rows: T[]) => void
  onSave: (rows: T[]) => void
}) {
  const update = (index: number, key: keyof T & string, value: string) => onChange(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)))
  return (
    <section className="profile-list">
      <h3 className="card-label">{title}</h3>
      {rows.length === 0 ? <p className="auth-note">No {title.toLowerCase()} yet.</p> : null}
      {rows.map((row, index) => (
        <div className="profile-row" key={index}>
          {fields.map((field) => (
            <input
              key={field.key}
              className="text-input"
              aria-label={`${title}: ${field.placeholder}`}
              placeholder={field.placeholder}
              value={typeof row[field.key] === 'string' ? (row[field.key] as string) : ''}
              onChange={(event) => update(index, field.key, event.target.value)}
              onBlur={() => onSave(rows)}
            />
          ))}
          <Button variant="ghost" type="button" onClick={() => { const next = rows.filter((_, at) => at !== index); onChange(next); onSave(next) }}>Remove</Button>
        </div>
      ))}
      <Button variant="secondary" type="button" onClick={() => onChange([...rows, { ...blank }])}>{addLabel}</Button>
    </section>
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
