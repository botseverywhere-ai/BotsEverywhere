import { useEffect, useState, type ReactNode, type MouseEvent } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { IMPORT_LOCKED, importLocked } from '../../server/src/bots-file.ts'
import { FOLDER_EVENT, orgFolder, seatsFolder } from '../org/folder-path'
import { Button } from './Button'
import { BotsFileImport, downloadBotsFile } from './BotsFileImport'
import { FILE_NAMES, FILE_WHAT, botsLine } from './file-guide-copy'
import { SaveAlert } from './SaveAlert'
import { connectorImportNotice } from './sync-copy'

type LinkPanel = 'grok' | 'template'

export function LinkCompany({
  slug,
  seats,
  onImported,
  onAddSeat,
  onAddExisting,
  defaultOpen = null,
  connectorRan = false,
  mainBot = '',
  onNotice,
}: {
  slug: string
  seats: SeatDocument[]
  onImported: () => Promise<void>
  /** Add a seat, as on the org chart: a person or a bot. */
  onAddSeat: () => void
  onAddExisting: () => void
  /** Organization Overview leaves every panel closed. The empty-organization start screen opens the first. */
  defaultOpen?: LinkPanel | null
  /** The Connector has reported: Option 1 can import from what it read, with nothing to paste. */
  connectorRan?: boolean
  /** The main bot's Grok Bot id: it does not lock the import. */
  mainBot?: string
  /** Tells the page's notices, which stay after this step closes. */
  onNotice?: (ok: boolean, message: string) => void
}) {
  const [open, setOpen] = useState<LinkPanel | null>(defaultOpen)
  // The writer's real folder once the sync status named it, so the path is the one on this computer.
  const [folder, setFolder] = useState(() => orgFolder(slug))
  useEffect(() => {
    const onFolder = (event: Event) => {
      const detail = (event as CustomEvent<{ slug?: string; value?: string }>).detail
      if (detail?.slug === slug && typeof detail.value === 'string') setFolder(detail.value)
    }
    window.addEventListener(FOLDER_EVENT, onFolder)
    return () => window.removeEventListener(FOLDER_EVENT, onFolder)
  }, [slug])
  const locked = importLocked(seats, mainBot)
  const seatsAt = seatsFolder(folder)

  function pick(id: LinkPanel, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setOpen((current) => (current === id ? null : id))
  }

  return (
    <section className="link-company connect-grok" aria-labelledby="link-company-title">
      <h2 id="link-company-title"><span className="step-label">Step 2</span>How to link your organization to BotsEverywhere</h2>
      {locked ? (
        <>
          <p>{IMPORT_LOCKED}</p>
          <dl className="connect-facts">
            <dt>Status</dt>
            <dd className="connect-status">
              <span className="connect-badge is-connected"><i aria-hidden="true" />Linked</span>
              <span className="connect-status-detail">{botsLine(seats)}</span>
            </dd>
            <dt>Bot files</dt>
            <dd className="connect-file">
              <code title={seatsAt}>{FILE_NAMES.seats}</code>
              <span>{FILE_WHAT.seats}</span>
              <span className="connect-file-fact">{seatsAt}</span>
            </dd>
          </dl>
          <div className="dir-actions">
            <Button variant="primary" type="button" onClick={onAddSeat}>Add a seat</Button>
            <Button variant="secondary" href="#/directory">Bot directory</Button>
            <Button variant="secondary" type="button" onClick={onAddExisting}>Add existing bot</Button>
            <Button variant="secondary" type="button" onClick={() => downloadBotsFile(seats)}>Export bots file</Button>
          </div>
        </>
      ) : (
        <>
          <p className="overview-note">Pick one way to fill this organization. You can do this before or after Step 1.</p>
          <Panel id="import-from-grok" option={1} title="Import from your Grok Bot" open={open === 'grok'} onPick={(event) => pick('grok', event)}>
            <ConnectorImport slug={slug} ready={connectorRan} onImported={onImported} onNotice={onNotice} />
          </Panel>
          <Panel id="import-from-template" option={2} title="Import from a template .json" badge="build an organization from an interview with an LLM" open={open === 'template'} onPick={(event) => pick('template', event)}>
            <BotsFileImport slug={slug} onImported={onImported} />
          </Panel>
        </>
      )}
    </section>
  )
}

/**
 * Import from the Connector: every bot it read in Grok Bot, with who each reports to. Nothing to paste. Until the
 * Connector's first run there is nothing to import, so the button waits and says why.
 */
function ConnectorImport({ slug, ready, onImported, onNotice }: { slug: string; ready: boolean; onImported: () => Promise<void>; onNotice?: (ok: boolean, message: string) => void }) {
  const [state, setState] = useState<{ busy: boolean; ok: boolean; message: string } | null>(null)
  async function run() {
    setState({ busy: true, ok: true, message: '' })
    try {
      const response = await fetch(`/api/orgs/${slug}/connector-import`, { method: 'POST' })
      const body = (await response.json()) as { imported?: unknown[]; greyed?: unknown[]; notes?: { name: string; note: string }[]; errors?: { name: string; error: string }[]; error?: string }
      if (!response.ok) {
        setState({ busy: false, ok: false, message: body.error || 'Could not import from the Connector.' })
        return
      }
      const message = connectorImportNotice({ imported: body.imported ?? [], greyed: body.greyed ?? [], notes: body.notes ?? [], errors: body.errors ?? [] })
      setState({ busy: false, ok: true, message })
      // This step closes once the organization has bots, so the page's notices carry the result.
      onNotice?.(!body.errors?.length, message)
      await onImported()
    } catch {
      setState({ busy: false, ok: false, message: 'Saving is off. Restart npm run dev.' })
    }
  }
  return (
    <div className="connector-import">
      <p className="overview-note">
        <strong>Import from the Connector</strong> brings in every bot the Connector read in Grok Bot on its last run. There is nothing to paste or download.
      </p>
      <p className="overview-note">
        Each bot comes in under the managers you gave it in BotsEverywhere, which the Connector keeps in a BotsEverywhere block in its instructions, also from an
        earlier copy of BotsEverywhere for an organization with the same name. A bot without one goes under the manager its own instructions name, or under You.
      </p>
      <p className="overview-note">A bot already working in another organization here comes in greyed.</p>
      {ready ? null : <p className="overview-note">The button works after the Connector&apos;s first run. Do Step 1 first: copy the Connector prompt and paste it into Grok Bot.</p>}
      <div className="dir-actions">
        <Button variant="primary" type="button" disabled={!ready || state?.busy} aria-busy={state?.busy || undefined} onClick={() => void run()}>Import from the Connector</Button>
      </div>
      {state?.message ? <SaveAlert kind={state.ok ? 'ok' : 'bad'}>{state.message}</SaveAlert> : null}
    </div>
  )
}

function Panel({
  id,
  option,
  title,
  badge,
  open,
  onPick,
  children,
}: {
  id: string
  option: number
  title: string
  /** How this way in works, shown as a badge after the title. */
  badge?: string
  open: boolean
  onPick: (event: MouseEvent<HTMLElement>) => void
  children: ReactNode
}) {
  return (
    <details className="link-panel" id={id} open={open}>
      <summary onClick={onPick}>
        <span><span className="link-panel-option">Option {option}</span>{title}{badge ? <span className="dir-pill link-panel-badge">{badge}</span> : null}</span>
        <span className="grok-chevron" aria-hidden="true" />
      </summary>
      <div className="link-panel-body">{children}</div>
    </details>
  )
}
