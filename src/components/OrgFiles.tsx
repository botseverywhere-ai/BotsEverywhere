import { useRef, useState } from 'react'
import { APP_MODE } from '../mode'
import { Button } from './Button'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'
import { companiesChanged } from '../org/company-list'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then try again.'

/** A bot's daily run log, which is restored as it is rather than read as an event. */
const RUN_LOG_NAME = /^\d{4}-\d{2}-\d{2}\.md$/

/** What Export puts in the zip and what Import does with it, read from orgZip and importOrgBundle in the writer. */
const BACKUP_ROWS: { what: string; file: string; saved: boolean; restore: string }[] = [
  { what: 'Organization fields and org chart', file: 'org.md', saved: true, restore: 'Restored' },
  { what: 'Work chart', file: 'work-chart.md', saved: true, restore: 'Restored' },
  { what: 'Seats: people, bots, and systems', file: 'seats/', saved: true, restore: 'Restored. Seats not in the backup are kept; active bots among them are retired, never deleted' },
  { what: 'Work Chart processes', file: 'processes/', saved: true, restore: 'Restored exactly as in the backup' },
  { what: 'Log events: hires, syncs, Connector lines', file: 'log/', saved: true, restore: 'Restored' },
  { what: 'Daily run logs the bots write', file: 'log/YYYY-MM-DD.md', saved: true, restore: 'Restored exactly as in the backup' },
  { what: "Connector's snapshot and waiting requests", file: 'grok/', saved: false, restore: 'Kept as they are now. The Connector rewrites them on its next run' },
]

export function OrgFiles({ slug, onImported }: { slug: string; onImported: () => Promise<void> }) {
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  if (APP_MODE !== 'template') {
    return <p>Import and export run on your own copy, after <code>npm run dev</code>.</p>
  }
  return (
    <div className="org-files">
      <div className="dir-actions">
        <Button variant="secondary" type="button" onClick={() => void exportOrg(slug, setNotice)}>Export</Button>
        <Button variant="secondary" type="button" onClick={() => zipRef.current?.click()}>Import zip</Button>
        <Button variant="secondary" type="button" onClick={() => folderRef.current?.click()}>Import folder</Button>
      </div>
      {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
      <h3 className="backup-heading">What a backup includes</h3>
      <p className="overview-note"><strong>Export</strong> downloads <code>{slug}.zip</code>. This is what it holds, and what <strong>Import</strong> does with each part.</p>
      <div className="backup-table-wrap">
        <table className="backup-table">
          <thead>
            <tr>
              <th scope="col">Part of the organization</th>
              <th scope="col">In the zip</th>
              <th scope="col">On import</th>
            </tr>
          </thead>
          <tbody>
            {BACKUP_ROWS.map((row) => (
              <tr key={row.what}>
                <th scope="row">{row.what}<span className="backup-file">{row.file}</span></th>
                <td><span className={row.saved ? 'backup-yes' : 'backup-no'}>{row.saved ? 'Yes' : 'No'}</span></td>
                <td>{row.restore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="backup-heading">Restore a backup</h3>
      <ol className="backup-steps">
        <li>Choose <strong>Export</strong> first, so you can go back to how things are now.</li>
        <li>Choose <strong>Import zip</strong> and pick a zip you exported, or <strong>Import folder</strong> and pick an organization folder.</li>
        <li>Confirm. The organization reloads from the restored files.</li>
      </ol>
      <p className="backup-warning" role="note">
        <strong>This replaces everything in this org</strong> with what the backup holds, processes and run logs included. Export first if you may want to go back.
        A zip exported before this version has no processes or run logs; importing it keeps the ones you have now.
      </p>
      <input
        ref={zipRef}
        className="be-file"
        type="file"
        accept=".zip,application/zip"
        aria-label="Import zip"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (!window.confirm('This replaces everything in this org')) return
          void importZip(slug, file, setNotice, onImported)
        }}
      />
      <input
        ref={folderRef}
        className="be-file"
        type="file"
        multiple
        aria-label="Import folder"
        // @ts-expect-error folder import is non-standard but supported in Chromium
        webkitdirectory=""
        onChange={(event) => {
          const files = event.target.files
          event.target.value = ''
          if (!files?.length) return
          if (!window.confirm('This replaces everything in this org')) return
          void importOrg(slug, files, setNotice, onImported)
        }}
      />
    </div>
  )
}

async function exportOrg(slug: string, setNotice: (notice: SaveNotice | null) => void) {
  setNotice(null)
  try {
    const response = await fetch(`/api/orgs/${slug}/export`)
    if (!response.ok) {
      setNotice(saveNotice(false, 'Could not export this org.'))
      return
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slug}.zip`
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    setNotice(saveNotice(false, SAVING_OFF))
  }
}

async function finishImport(response: Response, setNotice: (notice: SaveNotice | null) => void, onImported: () => Promise<void>) {
  const body = (await response.json()) as { errors?: string[]; error?: string }
  if (!response.ok) {
    setNotice(saveNotice(false, body.errors?.join(' ') || body.error || 'Import failed.', 'Not imported'))
    return
  }
  try {
    await onImported()
    companiesChanged()
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The chart could not be re-read.'
    setNotice(saveNotice(false, reason, 'Not imported'))
    return
  }
  setNotice(saveNotice(true, 'Org imported'))
}

async function importZip(slug: string, file: File, setNotice: (notice: SaveNotice | null) => void, onImported: () => Promise<void>) {
  setNotice(null)
  try {
    const response = await fetch(`/api/orgs/${slug}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: new Uint8Array(await file.arrayBuffer()),
    })
    await finishImport(response, setNotice, onImported)
  } catch {
    setNotice(saveNotice(false, SAVING_OFF, 'Not imported'))
  }
}

async function importOrg(slug: string, list: FileList, setNotice: (notice: SaveNotice | null) => void, onImported: () => Promise<void>) {
  setNotice(null)
  try {
    const files = [...list]
    const read = async (name: string) => {
      const file = files.find((item) => item.name === name || item.webkitRelativePath.endsWith(`/${name}`))
      if (!file) throw new Error(`${name}: file is missing.`)
      return file.text()
    }
    const orgFile = files.find((item) => item.name === 'org.md' || item.webkitRelativePath.endsWith('/org.md'))
    const workFile = files.find((item) => item.name === 'work-chart.md' || item.webkitRelativePath.endsWith('/work-chart.md'))
    let org: unknown
    let work: unknown
    let activity: unknown[] = []
    if (orgFile && workFile && (await orgFile.text()).includes('## Chart')) {
      const { parseOrgMarkdown, parseWorkMarkdown, parseLogMarkdown } = await import('../../server/src/org-markdown.ts')
      const parsedOrg = parseOrgMarkdown(await orgFile.text())
      const parsedWork = parseWorkMarkdown(await workFile.text())
      if (!parsedOrg.ok) throw new Error(parsedOrg.errors.join(' '))
      if (!parsedWork.ok) throw new Error(parsedWork.errors.join(' '))
      org = parsedOrg.org
      work = parsedWork.work
      // Daily run logs are not events; they go to the writer as they are, below.
      for (const file of files.filter((item) => item.name.endsWith('.md') && item.webkitRelativePath.includes('/log/') && !RUN_LOG_NAME.test(item.name))) {
        const parsed = parseLogMarkdown(await file.text(), file.name)
        if (!parsed.ok) throw new Error(parsed.errors.join(' '))
        activity.push(parsed.event)
      }
    } else {
      org = JSON.parse(await read('org.json'))
      work = JSON.parse(await read('workchart.json'))
      const activityFile = files.find((item) => item.name === 'activity.jsonl')
      const activityText = activityFile ? await activityFile.text() : ''
      activity = activityText.trim() ? activityText.trim().split(/\n/).map((line) => JSON.parse(line) as unknown) : []
    }
    const seats = []
    for (const file of files.filter((item) => item.name.endsWith('.md') && item.webkitRelativePath.includes('/seats/'))) {
      const source = await file.text()
      seats.push({ slug: file.name.replace(/\.md$/, ''), source })
    }
    // The folder is the whole organization, so its processes and run logs are restored too.
    const processes = []
    for (const file of files.filter((item) => item.webkitRelativePath.includes('/processes/') && /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(item.name))) {
      processes.push({ slug: file.name.replace(/\.md$/, ''), source: await file.text() })
    }
    const runLogs = []
    for (const file of files.filter((item) => item.webkitRelativePath.includes('/log/') && RUN_LOG_NAME.test(item.name))) {
      runLogs.push({ name: file.name, source: await file.text() })
    }
    const response = await fetch(`/api/orgs/${slug}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org, seats, work, activity, processes, runLogs }),
    })
    await finishImport(response, setNotice, onImported)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Import failed.'
    setNotice(saveNotice(false, reason, 'Not imported'))
  }
}
