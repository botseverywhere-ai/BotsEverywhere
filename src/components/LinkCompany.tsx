import { useEffect, useState, type ReactNode, type MouseEvent } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { IMPORT_LOCKED, importLocked } from '../../server/src/bots-file.ts'
import { FOLDER_EVENT, orgFolder, seatsFolder } from '../org/folder-path'
import { Button } from './Button'
import { BotsFileImport, downloadBotsFile } from './BotsFileImport'
import { FILE_NAMES, FILE_WHAT, botsLine } from './file-guide-copy'
import { SaveAlert } from './SaveAlert'
import { connectorImportLine } from './sync-copy'

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
            {connectorRan ? <ConnectorImport slug={slug} onImported={onImported} /> : null}
            <BotsFileImport slug={slug} mode="grok" onImported={onImported} />
          </Panel>
          <Panel id="import-from-template" option={2} title="Import from a template .json" badge="build an organization from an interview with an LLM" open={open === 'template'} onPick={(event) => pick('template', event)}>
            <BotsFileImport slug={slug} mode="template" onImported={onImported} />
          </Panel>
        </>
      )}
    </section>
  )
}

/** Import from the Connector: every bot it read in Grok Bot, with who each reports to. Nothing to paste. */
function ConnectorImport({ slug, onImported }: { slug: string; onImported: () => Promise<void> }) {
  const [state, setState] = useState<{ busy: boolean; ok: boolean; message: string } | null>(null)
  async function run() {
    setState({ busy: true, ok: true, message: '' })
    try {
      const response = await fetch(`/api/orgs/${slug}/connector-import`, { method: 'POST' })
      const body = (await response.json()) as { imported?: unknown[]; greyed?: unknown[]; error?: string }
      if (!response.ok) {
        setState({ busy: false, ok: false, message: body.error || 'Could not import from the Connector.' })
        return
      }
      setState({ busy: false, ok: true, message: connectorImportLine(body.imported?.length ?? 0, body.greyed?.length ?? 0) })
      await onImported()
    } catch {
      setState({ busy: false, ok: false, message: 'Saving is off. Restart npm run dev.' })
    }
  }
  return (
    <div className="connector-import">
      <Button variant="primary" type="button" disabled={state?.busy} aria-busy={state?.busy || undefined} onClick={() => void run()}>Import from the Connector</Button>
      <p className="overview-note">Every bot comes in with who it reports to. Bots already in another organization come in greyed.</p>
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
