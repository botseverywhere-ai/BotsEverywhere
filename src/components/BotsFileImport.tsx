import { useRef, useState } from 'react'
import { exportBotsFile, parseBotsFile, type BotsFileRow } from '../../server/src/bots-file.ts'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { BOTS_FILE_NAME } from '../content/grok-bots-prompt'
import { Button } from './Button'
import { GrokBotsPrompt } from './GrokBotsPrompt'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then try again.'

export function BotsFileImport({
  slug,
  seats = [],
  onImported,
  mode = 'grok',
}: {
  slug: string
  seats?: SeatDocument[]
  onImported: () => Promise<void>
  mode?: 'grok' | 'template'
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<BotsFileRow[] | null>(null)
  const [raw, setRaw] = useState('')
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = rows?.filter((row) => !row.error) ?? []

  async function choose(file: File) {
    setNotice(null)
    const text = await file.text()
    const parsed = parseBotsFile(text)
    if (!parsed.ok) {
      setRows(null)
      setRaw('')
      setNotice(saveNotice(false, parsed.errors.join(' '), 'Not imported'))
      return
    }
    setRaw(text)
    setRows(parsed.rows)
  }

  async function confirm() {
    if (!raw || busy || ready.length === 0) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/orgs/${slug}/bots-file`, {
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
      const notes = noteCountFor(imported, ready)
      if (imported.length > 0) {
        const summary = importedLabel(imported.length, notes)
        const skipped = problems.map((item) => `Skipped ${item.name}: ${item.error}`).join(' ')
        setNotice(saveNotice(true, skipped ? `${summary}. ${skipped}` : summary))
        setRows(null)
        setRaw('')
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

  const preview = rows ? (
          <div className="bots-preview">
            <p className="overview-note">Nothing is written until you confirm. Bots that already have a file are saved beside it, not over it.</p>
            <p className="overview-note">{readySummary(rows)}</p>
            <ul>
              {rows.map((row, index) => (
                <li key={`${row.name}-${index}`}>
                  <strong>{row.name}</strong>
                  <span>reports to {row.reportsTo}</span>
                  {row.note ? <span className="bots-note">{row.note}</span> : null}
                  {row.error ? <span className="form-error">{row.error}</span> : null}
                </li>
              ))}
            </ul>
            <div className="dir-actions">
              <Button variant="primary" type="button" disabled={busy || ready.length === 0} onClick={() => void confirm()}>
                {busy ? 'Importing…' : `Import ${ready.length} ${ready.length === 1 ? 'bot' : 'bots'}`}
              </Button>
              <Button variant="secondary" type="button" disabled={busy} onClick={() => { setRows(null); setRaw('') }}>Cancel</Button>
            </div>
          </div>
  ) : null

  return (
    <div className="bots-file">
      {mode === 'template' ? (
        <>
          <p className="overview-note">Download the template, fill it in (or use a file you exported), then import.</p>
          <div className="dir-actions">
            <Button variant="secondary" href="/bots-file-template.json" download="bots.json">Download bots file template</Button>
            {importButton}
            <Button variant="secondary" type="button" onClick={() => downloadBotsFile(seats)}>Export bots file</Button>
          </div>
        </>
      ) : (
        <GrokBotsPrompt importAction={importButton}>{preview}</GrokBotsPrompt>
      )}
      {mode === 'template' ? preview : null}
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

function readySummary(rows: BotsFileRow[]): string {
  const ready = rows.filter((row) => !row.error)
  const notes = ready.filter((row) => row.note).length
  const bots = ready.length === 1 ? '1 bot' : `${ready.length} bots`
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

function downloadBotsFile(seats: SeatDocument[]) {
  const blob = new Blob([exportBotsFile(seats)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = BOTS_FILE_NAME
  link.click()
  URL.revokeObjectURL(url)
}
