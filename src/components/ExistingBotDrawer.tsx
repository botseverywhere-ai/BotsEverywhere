import { useState } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { isSeatGrokLink } from '../../server/src/org-files.ts'
import { Button } from './Button'
import { SaveAlert } from './SaveAlert'
import { saveNotice } from './save-notice'

const SECTIONS = [
  ['owns', 'Owns'],
  ['may', 'May'],
  ['mustAskBefore', 'Needs approval'],
  ['doneWhen', 'Done when'],
] as const

export type ExistingBotDraft = {
  name: string
  grokBotUrl: string
  reportsTo: string
  owns: string[]
  may: string[]
  mustAskBefore: string[]
  doneWhen: string[]
  /** Add anyway: keep it active in the other organization too. */
  allowOtherOrgs?: boolean
}

/** `otherOrgs` when the bot is already active in another organization. */
export type ExistingBotResult = { ok: true } | { ok: false; error: string; otherOrgs?: string[] }

export function ExistingBotDrawer({
  orgSlug,
  seats,
  onClose,
  onSave,
}: {
  orgSlug: string
  seats: SeatDocument[]
  onClose: () => void
  onSave: (draft: ExistingBotDraft) => Promise<ExistingBotResult>
}) {
  const managers = seats.filter((seat) => seat.status !== 'retired')
  const you = defaultManager(managers)
  const [name, setName] = useState('')
  const [grokBotUrl, setGrokBotUrl] = useState('')
  const [reportsTo, setReportsTo] = useState(you?.slug ?? '')
  const [lines, setLines] = useState<Record<(typeof SECTIONS)[number][0], string>>({
    owns: '',
    may: '',
    mustAskBefore: '',
    doneWhen: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // Why this bot is already in another organization. Add anyway is for the main bot, which belongs in every one.
  const [elsewhere, setElsewhere] = useState('')
  const link = grokBotUrl.trim()
  const linkError = link && !isSeatGrokLink(link) ? 'Use an http, https, or grokbot:// link.' : ''
  const emptySection = SECTIONS.find(([key]) => splitLines(lines[key]).length === 0)?.[1] ?? null
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  const blocked = !name.trim() || !reportsTo || emptySection !== null || Boolean(linkError)

  function close() {
    if (saving) return
    onClose()
  }

  async function submit(anyway = false) {
    if (saving || blocked) return
    setSaving(true)
    setSaveError('')
    setElsewhere('')
    const result = await onSave({
      name: name.trim(),
      grokBotUrl: link,
      reportsTo,
      owns: splitLines(lines.owns),
      may: splitLines(lines.may),
      mustAskBefore: splitLines(lines.mustAskBefore),
      doneWhen: splitLines(lines.doneWhen),
      ...(anyway ? { allowOtherOrgs: true } : {}),
    })
    if (!result.ok) {
      if (result.otherOrgs?.length) setElsewhere(result.error)
      else setSaveError(result.error)
      setSaving(false)
    }
  }

  return (
    <div className="be-scrim" onClick={close}>
      <aside className="be-drawer be-hire" role="dialog" aria-labelledby="existing-bot-title" onClick={(event) => event.stopPropagation()}>
        <div className="be-hire-scroll">
          <header className="be-hire-head">
            <h2 id="existing-bot-title">Add existing bot</h2>
            <button type="button" className="be-icon" onClick={close} aria-label="Close" disabled={saving}>
              ×
            </button>
          </header>
          <label>
            Bot name
            <input value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
          </label>
          <label>
            Grok Bot link
            <input
              value={grokBotUrl}
              placeholder="https://"
              onChange={(event) => {
                setGrokBotUrl(event.target.value)
                setElsewhere('')
              }}
              disabled={saving}
            />
            <span className="be-field-help">Optional. Any http or https link.</span>
            {linkError ? <span className="be-inline">{linkError}</span> : null}
          </label>
          <label>
            Reports to
            <select value={reportsTo} onChange={(event) => setReportsTo(event.target.value)} disabled={saving || managers.length === 0}>
              {managers.map((seat) => (
                <option key={seat.slug} value={seat.slug}>
                  {seat.title || seat.slug}
                </option>
              ))}
            </select>
          </label>
          {SECTIONS.map(([key, label]) => {
            const items = splitLines(lines[key])
            return (
              <div className="be-field" key={key}>
                <span className="be-label-row">
                  {label}
                  {items.length === 0 ? <em>NEEDED</em> : null}
                </span>
                <textarea
                  rows={2}
                  value={lines[key]}
                  disabled={saving}
                  onChange={(event) => setLines((current) => ({ ...current, [key]: event.target.value }))}
                />
                {items.length === 0 ? <span className="be-inline">{label} is empty.</span> : null}
              </div>
            )
          })}
        </div>
        <footer className="be-hire-foot">
          <p className="be-hire-path">Save writes orgs/{orgSlug}/seats/{slug || '…'}.md</p>
          {saveError ? <SaveAlert kind="bad">{saveNotice(false, saveError).message}</SaveAlert> : null}
          {elsewhere ? (
            <>
              <SaveAlert kind="bad">{elsewhere}</SaveAlert>
              <p className="be-caption">Only your main bot belongs in every organization.</p>
              <div className="existing-elsewhere-actions">
                <Button variant="primary" type="button" disabled={saving} aria-busy={saving || undefined} onClick={() => void submit(true)}>Add anyway</Button>
                <Button variant="secondary" type="button" disabled={saving} onClick={() => setElsewhere('')}>Cancel</Button>
              </div>
            </>
          ) : (
            <Button
              variant="primary"
              className={saving ? 'is-busy btn-block' : 'btn-block'}
              type="button"
              disabled={saving || blocked}
              aria-busy={saving || undefined}
              onClick={() => void submit()}
            >
              {saving ? 'Saving' : 'Save'}
            </Button>
          )}
        </footer>
      </aside>
    </div>
  )
}

function defaultManager(seats: SeatDocument[]): SeatDocument | undefined {
  return seats.find((seat) => seat.title.trim().toLowerCase() === 'you')
    ?? seats.find((seat) => seat.slug === 'you')
    ?? seats.find((seat) => seat.kind === 'human')
}

function splitLines(value: string): string[] {
  return value.split(/\n/).map((line) => line.trim()).filter(Boolean)
}
