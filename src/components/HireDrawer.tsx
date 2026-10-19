import { useState } from 'react'
import { emptyHireTitle, firstEmptySection } from '../content/principles'
import { STEP_ASSIGN_HELP } from '../content/hiring-guide.ts'
import { HiringGuide } from '../content/HiringGuide.tsx'
import { MeterFill } from './MeterFill'
import type { DirectoryEntry } from '../../server/src/directory-entries.ts'
import type { OrgBundle, SeatDocument, WorkDocument } from '../../server/src/org-files.ts'
import { Button } from './Button'
import { SaveAlert } from './SaveAlert'
import { saveNotice } from './save-notice'

const SECTIONS = [
  ['owns', 'Owns'],
  ['may', 'May'],
  ['mustAskBefore', 'Needs approval'],
  ['doneWhen', 'Done when'],
] as const

export type OrgChoice = { slug: string; name: string }

export type HireDraft = {
  name: string
  reportsTo: string
  owns: string[]
  may: string[]
  mustAskBefore: string[]
  doneWhen: string[]
  stepId: string
  directoryId: string
  orgSlug: string
  newOrg?: { name: string; owner: string }
}

export type HireResult = { ok: true } | { ok: false; error: string }

const NEW_ORG = '__new__'

export function HireDrawer({
  orgSlug,
  orgName,
  orgs,
  seats,
  work,
  entry,
  stepId,
  onClose,
  onHire,
}: {
  orgSlug: string
  orgName: string
  orgs: OrgChoice[]
  seats: SeatDocument[]
  work: WorkDocument
  entry: DirectoryEntry | null
  stepId: string
  onClose: () => void
  onHire: (draft: HireDraft) => Promise<HireResult>
}) {
  const choices = orgs.some((org) => org.slug === orgSlug) ? orgs : [{ slug: orgSlug, name: orgName }, ...orgs]
  const initialOrg = choices.some((org) => org.slug === orgSlug) ? orgSlug : choices.length === 1 ? choices[0]!.slug : orgSlug
  const root = seats.find((seat) => seat.kind === 'human' && !seat.reportsTo) ?? seats.find((seat) => seat.kind === 'human')
  const [name, setName] = useState(entry?.name ?? '')
  const [target, setTarget] = useState(initialOrg)
  const [newName, setNewName] = useState('')
  const [newOwner, setNewOwner] = useState('You')
  const [remote, setRemote] = useState<OrgBundle | null>(null)
  const [reportsTo, setReportsTo] = useState(root?.slug ?? '')
  const [lines, setLines] = useState<Record<(typeof SECTIONS)[number][0], string>>({
    owns: (entry?.seatCard.owns ?? []).join('\n'),
    may: (entry?.seatCard.may ?? []).join('\n'),
    mustAskBefore: (entry?.seatCard.mustAskBefore ?? []).join('\n'),
    doneWhen: (entry?.seatCard.doneWhen ?? []).join('\n'),
  })
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [step, setStep] = useState(stepId)
  const [saving, setSaving] = useState(false)
  const [hireError, setHireError] = useState('')
  const filled = SECTIONS.filter(([key]) => splitLines(lines[key]).length > 0).length
  const emptySection = firstEmptySection(lines)
  const creating = target === NEW_ORG
  const activeSeats = creating ? newOrgSeats(newOwner) : target === orgSlug ? seats : remote?.seats ?? []
  const activeWork = creating ? newOrgWork() : target === orgSlug ? work : remote?.work ?? emptyWork()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  const targetSlug = creating ? 'new-org' : target
  const blocked = emptySection !== null || !name.trim() || (creating && (!newName.trim() || !newOwner.trim())) || (!creating && target !== orgSlug && !remote)

  async function chooseOrg(next: string) {
    setTarget(next)
    setHireError('')
    if (next === orgSlug) {
      setRemote(null)
      setReportsTo(root?.slug ?? '')
      setStep(stepId)
      return
    }
    if (next === NEW_ORG) {
      setRemote(null)
      setReportsTo('you')
      setStep('')
      return
    }
    setRemote(null)
    try {
      const response = await fetch(`/api/orgs/${next}`)
      if (!response.ok) throw new Error('Could not read that org.')
      const bundle = (await response.json()) as OrgBundle
      setRemote(bundle)
      const nextRoot = bundle.seats.find((seat) => seat.kind === 'human' && !seat.reportsTo) ?? bundle.seats.find((seat) => seat.kind === 'human')
      setReportsTo(nextRoot?.slug ?? '')
      setStep('')
    } catch {
      setHireError('Could not read that org.')
    }
  }

  function close() {
    if (saving) return
    onClose()
  }

  async function submit() {
    if (saving || blocked) return
    setSaving(true)
    setHireError('')
    const result = await onHire({
      name: name.trim(),
      reportsTo: creating ? 'you' : reportsTo,
      owns: splitLines(lines.owns),
      may: splitLines(lines.may),
      mustAskBefore: splitLines(lines.mustAskBefore),
      doneWhen: splitLines(lines.doneWhen),
      stepId: step,
      directoryId: entry?.id ?? '',
      orgSlug: creating ? '' : target,
      newOrg: creating ? { name: newName.trim(), owner: newOwner.trim() || 'You' } : undefined,
    })
    if (!result.ok) {
      setHireError(result.error)
      setSaving(false)
    }
  }

  return (
    <div className="be-scrim" onClick={close}>
    <aside className="be-drawer be-hire" role="dialog" aria-labelledby="hire-title" onClick={(event) => event.stopPropagation()}>
      <div className="be-hire-scroll">
      <header className="be-hire-head">
        <h2 id="hire-title">{entry ? `Hire ${entry.name}` : 'Hire a bot'}</h2>
        <button type="button" className="be-icon" onClick={close} aria-label="Close" disabled={saving}>
          ×
        </button>
      </header>
      <label>
        Hire into
        <select
          value={target}
          disabled={saving}
          onChange={(event) => void chooseOrg(event.target.value)}
        >
          {choices.map((org) => (
            <option key={org.slug} value={org.slug}>{org.name}</option>
          ))}
          <option value={NEW_ORG}>+ New org</option>
        </select>
      </label>
      {creating ? (
        <>
          <label>
            New org name
            <input value={newName} onChange={(event) => setNewName(event.target.value)} disabled={saving} />
          </label>
          <label>
            Owner
            <input value={newOwner} onChange={(event) => setNewOwner(event.target.value)} disabled={saving} />
          </label>
        </>
      ) : null}
      <label>
        Seat name
        <input value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
      </label>
      <label>
        Reports to
        <select value={reportsTo} onChange={(event) => setReportsTo(event.target.value)} disabled={saving || creating || activeSeats.length === 0}>
          {activeSeats.filter((seat) => seat.status !== 'retired').map((seat) => (
            <option key={seat.slug} value={seat.slug}>
              {seat.title}
            </option>
          ))}
        </select>
      </label>
      {SECTIONS.map(([key, label]) => {
        const items = splitLines(lines[key])
        const original = entry?.seatCard[key] ?? []
        const fromDirectory = entry && items.join('\n') === original.join('\n') && !touched[key]
        return (
          <div className="be-field" key={key}>
            <span className="be-label-row">
              {label}
              {items.length === 0 ? <em>NEEDED</em> : null}
              {fromDirectory ? <small>from directory</small> : null}
            </span>
            {items.length === 0 ? <span className="be-add">+ Add at least one line</span> : null}
            <textarea
              rows={2}
              value={lines[key]}
              disabled={saving}
              onChange={(event) => {
                setTouched((current) => ({ ...current, [key]: true }))
                setLines((current) => ({ ...current, [key]: event.target.value }))
              }}
            />
            {items.length === 0 ? <span className="be-inline">{label} is empty. No card, no hire.</span> : null}
          </div>
        )
      })}
      <label>
        <span className="be-label-row">Assign to step</span>
        <select value={step} onChange={(event) => setStep(event.target.value)} disabled={saving}>
          <option value="">Not yet</option>
          {activeWork.steps.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="be-field-help">{STEP_ASSIGN_HELP}</span>
      </label>
      </div>
      <footer className="be-hire-foot">
        <HiringGuide collapsed />
        <div className="be-meter" aria-hidden="true">
          <MeterFill percent={(filled / 4) * 100} />
        </div>
        <p>{filled} of 4 filled</p>
        <p className="be-hire-path">Hire writes orgs/{targetSlug}/seats/{slug || '…'}.md and adds it to that org chart.</p>
        {hireError ? <SaveAlert kind="bad">{saveNotice(false, hireError).message}</SaveAlert> : null}
        <Button variant="primary" className={saving ? "is-busy btn-block" : "btn-block"}
          type="button"
          
          disabled={saving || blocked}
          aria-busy={saving || undefined}
          title={saving ? 'Hiring' : emptyHireTitle(emptySection) ?? (!name.trim() ? 'Seat name is empty. No card, no hire.' : undefined)}
          onClick={() => void submit()}
        >
          {saving ? (
            <span className="be-hire-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : 'Hire'}
          {saving ? <span className="sr-only">Hiring</span> : null}
        </Button>
      </footer>
    </aside>
    </div>
  )
}

function splitLines(value: string): string[] {
  return value.split(/\n/).map((line) => line.trim()).filter(Boolean)
}

function newOrgSeats(owner: string): SeatDocument[] {
  return [{
    slug: 'you',
    title: owner.trim() || 'You',
    department: 'general',
    reportsTo: '',
    addToGrokBotUrl: '',
    status: 'active',
    kind: 'human',
    role: 'Owner',
    personId: 'person-you',
    hiredAt: '',
    retiredAt: '',
    directoryId: '',
    owns: [],
    may: [],
    mustAskBefore: [],
    doneWhen: [],
    source: '',
  }]
}

function newOrgWork(): WorkDocument {
  return {
    triggers: [{ id: 'start', source: 'management', label: 'Start', example: 'Name the work' }],
    workstreams: [{ id: 'main', triggerId: 'start', outcome: 'The work is done', ownerSeatId: 'you', kind: 'main', stepIds: ['step-1'] }],
    steps: [{ id: 'step-1', workstreamId: 'main', name: 'First step', level: 2, executorSeatId: 'you' }],
    handoffs: [],
    checkpoints: [],
  }
}

function emptyWork(): WorkDocument {
  return { triggers: [], workstreams: [], steps: [], handoffs: [], checkpoints: [] }
}
