import { useRef, useState } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { ORG_IMPORT_LOCKED, orgImportLocked, parseOrgFile, type OrgFile, type OrgFilePerson } from '../../server/src/org-file.ts'
import { ORG_FILE_PROMPT } from '../content/org-file-prompt'
import { Button } from './Button'
import { GrokBotsPrompt } from './GrokBotsPrompt'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then try again.'

/** Option 4: an organization that already exists, from a file any AI fills in. People only; bots come after through Option 1 or 2. */
export function OrgFileImport({
  slug,
  seats,
  onImported,
}: {
  slug: string
  seats: SeatDocument[]
  onImported: () => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<OrgFile | null>(null)
  const [raw, setRaw] = useState('')
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [busy, setBusy] = useState(false)
  const locked = orgImportLocked(seats)
  const ready = file?.people.filter((person) => !person.error) ?? []

  async function choose(chosen: File) {
    setNotice(null)
    const text = await chosen.text()
    const parsed = parseOrgFile(text)
    if (!parsed.ok) {
      setFile(null)
      setRaw('')
      setNotice(saveNotice(false, parsed.errors.join(' '), 'Not imported'))
      return
    }
    setRaw(text)
    setFile(parsed.file)
  }

  async function confirm() {
    if (!raw || busy || ready.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/orgs/${slug}/org-file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      })
      const text = await response.text()
      const body = text.trimStart().startsWith('{') ? JSON.parse(text) as { imported?: { name: string }[]; errors?: unknown } : {}
      if (!response.ok) {
        const reasons = Array.isArray(body.errors) ? body.errors.map(String).join(' ') : 'Import failed.'
        setNotice(saveNotice(false, reasons, 'Not imported'))
        setBusy(false)
        return
      }
      const imported = body.imported ?? []
      try {
        await onImported()
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'The chart could not be re-read.'
        setNotice(saveNotice(false, reason, 'Not imported'))
        setBusy(false)
        return
      }
      setNotice(saveNotice(true, `Imported ${peopleLabel(imported.length)}. Next, add bots with Option 1 or Option 2.`))
      setFile(null)
      setRaw('')
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not imported'))
    }
    setBusy(false)
  }

  const importButton = (
    <Button variant="secondary" type="button" disabled={locked} onClick={() => fileRef.current?.click()}>Import organization file</Button>
  )

  const preview = file ? (
    <div className="bots-preview">
      <p className="overview-note">Nothing is written until you confirm. The organization keeps its name, and bots come after, through Option 1 or Option 2.</p>
      <p className="overview-note">{readySummary(file)}</p>
      {file.notes.map((note) => <p key={note} className="bots-note">{note}</p>)}
      <ul>
        {file.people.map((person, index) => (
          <li key={`${person.name}-${index}`}>
            <strong>{person.name}{person.name === file.you ? ' (You)' : ''}</strong>
            <span>{personLine(person)}</span>
            {person.note ? <span className="bots-note">{person.note}</span> : null}
            {person.error ? <span className="form-error">{person.error}</span> : null}
          </li>
        ))}
      </ul>
      <div className="dir-actions">
        <Button variant="primary" type="button" disabled={busy || ready.length === 0} onClick={() => void confirm()}>
          {busy ? 'Importing…' : `Import ${peopleLabel(ready.length)}`}
        </Button>
        <Button variant="secondary" type="button" disabled={busy} onClick={() => { setFile(null); setRaw('') }}>Cancel</Button>
      </div>
    </div>
  ) : null

  return (
    <>
      {locked ? <p className="overview-note">{ORG_IMPORT_LOCKED}</p> : null}
      <div className="bots-file">
        <GrokBotsPrompt
          prompt={ORG_FILE_PROMPT}
          pasteTitle="Step 1. Copy this prompt, fill in the blanks, and paste it into any AI with the template"
          copyActions={<Button variant="secondary" href="/organization-file-template.json" download="organization.json">Download organization file template</Button>}
          importTitle="Step 2. Import the .json file it writes"
          importAction={importButton}
        >
          {preview}
        </GrokBotsPrompt>
        {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
        <input
          ref={fileRef}
          className="be-file"
          type="file"
          accept="application/json,.json"
          aria-label="Import organization file"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            event.target.value = ''
            if (!chosen) return
            void choose(chosen)
          }}
        />
      </div>
    </>
  )
}

function peopleLabel(count: number): string {
  return count === 1 ? '1 person' : `${count} people`
}

/** Job title, department, and reporting line, as the org chart will show them. */
function personLine(person: OrgFilePerson): string {
  const parts = [person.title, person.department || 'General']
  const line = person.reportsTo ? `reports to ${person.reportsTo}` : 'at the top'
  const also = person.alsoReportsTo.length ? `, also ${person.alsoReportsTo.join(', ')}` : ''
  return [...parts.filter(Boolean), `${line}${also}`].join(' · ')
}

function readySummary(file: OrgFile): string {
  const ready = file.people.filter((person) => !person.error)
  const departments = new Set([...file.departments, ...ready.map((person) => person.department || 'General')].map((name) => name.toLowerCase()))
  const notes = ready.filter((person) => person.note).length
  const base = `${peopleLabel(ready.length)} in ${departments.size === 1 ? '1 department' : `${departments.size} departments`}`
  if (notes === 0) return `${base} ready to import.`
  return `${base} ready, ${notes === 1 ? '1 note' : `${notes} notes`}.`
}
