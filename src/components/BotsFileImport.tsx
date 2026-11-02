import { useRef, useState } from 'react'
import { exportBotsFile, parseBotsFile, type BotsFilePreview, type BotsFileRow } from '../../server/src/bots-file.ts'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { BOTS_FILE_NAME, localTimeZone } from '../content/grok-bots-prompt'
import { botsFilePrompt } from '../content/bots-file-prompt'
import { Button } from './Button'
import { GrokBotsPrompt } from './GrokBotsPrompt'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then try again.'

export function BotsFileImport({
  slug,
  onImported,
  mode = 'grok',
}: {
  slug: string
  onImported: () => Promise<void>
  mode?: 'grok' | 'template'
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<BotsFileRow[] | null>(null)
  const [raw, setRaw] = useState('')
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [busy, setBusy] = useState(false)
  // What the import would save, from the writer: a bot that works in another organization keeps its managers there.
  const [plan, setPlan] = useState<BotsFilePreview | null>(null)
  const ready = rows?.filter((row) => !row.error) ?? []

  function clear() {
    setRows(null)
    setRaw('')
    setPlan(null)
  }

  async function choose(file: File) {
    setNotice(null)
    const text = await file.text()
    const parsed = parseBotsFile(text)
    if (!parsed.ok) {
      clear()
      setNotice(saveNotice(false, parsed.errors.join(' '), 'Not imported'))
      return
    }
    setRaw(text)
    setRows(parsed.rows)
    setPlan(null)
    try {
      const response = await fetch(`/api/orgs/${slug}/bots-file/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text,
      })
      const answer = await response.text()
      const body = answer.trimStart().startsWith('{') ? JSON.parse(answer) as Partial<BotsFilePreview> & { error?: string; errors?: unknown } : {}
      if (!response.ok || !Array.isArray(body.rows)) {
        const reason = body.error || (Array.isArray(body.errors) ? body.errors.map(String).join(' ') : '') || 'Could not check this file.'
        clear()
        setNotice(saveNotice(false, reason, 'Not imported'))
        return
      }
      setPlan({ rows: body.rows, errors: Array.isArray(body.errors) ? body.errors : [] })
    } catch {
      clear()
      setNotice(saveNotice(false, SAVING_OFF, 'Not imported'))
    }
  }

  async function confirm() {
    if (!raw || busy || !plan || plan.rows.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/orgs/${slug}/bots-file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      })
      const text = await response.text()
      const body = text.trimStart().startsWith('{') ? JSON.parse(text) as { imported?: { name: string }[]; errors?: unknown; notes?: unknown } : {}
      if (!response.ok) {
        const reasons = Array.isArray(body.errors) ? body.errors.map(String).join(' ') : 'Import failed.'
        setNotice(saveNotice(false, reasons, 'Not imported'))
        setBusy(false)
        return
      }
      const imported = body.imported ?? []
      const problems = Array.isArray(body.errors)
        ? body.errors.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as { name?: string; error?: string }
          return [{ name: row.name || 'Bot', error: row.error || 'Could not import this bot.' }]
        })
        : []
      try {
        if (imported.length) await onImported()
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'The chart could not be re-read.'
        setNotice(saveNotice(false, reason, 'Not imported'))
        setBusy(false)
        return
      }
      const changed = Array.isArray(body.notes)
        ? body.notes.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as { name?: string; note?: string }
          return row.note ? [`${row.name || 'Bot'}: ${row.note}`] : []
        })
        : []
      const notes = noteCountFor(imported, ready) + changed.length
      if (imported.length > 0) {
        const summary = importedLabel(imported.length, notes)
        const skipped = problems.map((item) => `Skipped ${item.name}: ${item.error}`).join(' ')
        const detail = [...changed, skipped].filter(Boolean).join(' ')
        setNotice(saveNotice(true, detail ? `${summary}. ${detail}` : summary))
        clear()
      } else {
        setNotice(saveNotice(false, problems.map((item) => `${item.name}: ${item.error}`).join(' ') || 'Not imported', 'Not imported'))
      }
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not imported'))
    }
    setBusy(false)
  }

  const importButton = (
    <Button variant="secondary" type="button" onClick={() => fileRef.current?.click()}>Import bots file</Button>
  )

  // The file's own notes, such as a status it did not know, beside the writer's notes on where each bot goes.
  const fileNote = (name: string) => ready.find((row) => row.name === name)?.note ?? ''
  const count = plan?.rows.length ?? 0
  // A Grok Bot file only names the managers each bot's own text names, so Option 1 lists the bots' names alone. Option 2's
  // file is an organization the owner designed, so it shows who reports to whom and each note.
  const showManagers = mode === 'template'
  const namesOnly = !showManagers
  const preview = rows ? (
          <div className="bots-preview">
            <p className="overview-note">Nothing is written until you confirm. Bots that already have a file are saved beside it, not over it.</p>
            {plan ? <p className="overview-note">{readySummary(plan, fileNote, namesOnly)}</p> : <p className="overview-note">Checking where each bot goes…</p>}
            {plan ? (
              <ul>
                {plan.rows.map((row, index) => (
                  <li key={`${row.name}-${index}`}>
                    <strong>{row.name}</strong>
                    {showManagers ? <span>reports to {row.reportsTo}</span> : null}
                    {showManagers && row.alsoReportsTo.length ? <span>also reports to {row.alsoReportsTo.join(', ')}</span> : null}
                    {showManagers && row.worksIn.length ? <span className="bots-note">Works in {row.worksIn.join(', ')}: it comes in greyed, under the managers it has there.</span> : null}
                    {showManagers ? [fileNote(row.name), ...row.notes].filter(Boolean).map((note) => <span key={note} className="bots-note">{note}</span>) : null}
                  </li>
                ))}
                {plan.errors.map((item, index) => (
                  <li key={`error-${item.name}-${index}`}>
                    <strong>{item.name}</strong>
                    <span className="form-error">{item.error}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="dir-actions">
              <Button variant="primary" type="button" disabled={busy || count === 0} onClick={() => void confirm()}>
                {busy ? 'Importing…' : `Import ${count} ${count === 1 ? 'bot' : 'bots'}`}
              </Button>
              <Button variant="secondary" type="button" disabled={busy} onClick={clear}>Cancel</Button>
            </div>
          </div>
  ) : null

  return (
    <div className="bots-file">
      {mode === 'template' ? (
        <GrokBotsPrompt
          prompt={botsFilePrompt(localTimeZone())}
          pasteTitle="Step 1. Paste this prompt into any AI, with the template"
          copyActions={<Button variant="secondary" href="/bots-file-template.json" download="bots.json">Download bots file template</Button>}
          importTitle="Step 2. Import the .json file it writes"
          importAction={importButton}
        >
          {preview}
        </GrokBotsPrompt>
      ) : (
        <GrokBotsPrompt importAction={importButton}>{preview}</GrokBotsPrompt>
      )}
      {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
      <input
        ref={fileRef}
        className="be-file"
        type="file"
        accept="application/json,.json"
        aria-label="Import bots file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void choose(file)
        }}
      />
    </div>
  )
}

function importedLabel(count: number, notes = 0): string {
  if (notes > 0) {
    const bots = count === 1 ? '1 bot' : `${count} bots`
    const noteLabel = notes === 1 ? '1 note' : `${notes} notes`
    return `${bots} imported, ${noteLabel}`
  }
  return count === 1 ? 'Imported 1 bot' : `Imported ${count} bots`
}

function readySummary(plan: BotsFilePreview, fileNote: (name: string) => string, namesOnly = false): string {
  const notes = namesOnly ? 0 : plan.rows.filter((row) => fileNote(row.name) || row.notes.length).length
  const bots = plan.rows.length === 1 ? '1 bot' : `${plan.rows.length} bots`
  if (notes === 0) return `${bots} ready to import.`
  const noteLabel = notes === 1 ? '1 note' : `${notes} notes`
  return `${bots} ready, ${noteLabel}.`
}

function noteCountFor(imported: { name: string }[], ready: BotsFileRow[]): number {
  const pending = [...ready]
  let notes = 0
  for (const item of imported) {
    const index = pending.findIndex((row) => row.name === item.name)
    if (index < 0) continue
    const row = pending.splice(index, 1)[0]
    if (row?.note) notes += 1
  }
  return notes
}

export function downloadBotsFile(seats: SeatDocument[]) {
  const blob = new Blob([exportBotsFile(seats)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = BOTS_FILE_NAME
  link.click()
  URL.revokeObjectURL(url)
}
