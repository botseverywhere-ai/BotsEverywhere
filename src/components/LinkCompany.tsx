import { useEffect, useState, type ReactNode, type MouseEvent } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { IMPORT_LOCKED, importLocked } from '../../server/src/bots-file.ts'
import { WORK_CHART_LOCKED } from '../org/work-chart-lock'
import { FOLDER_EVENT, orgFolder, seatsFolder } from '../org/folder-path'
import { Button } from './Button'
import { BotsFileImport, downloadBotsFile } from './BotsFileImport'
import { OrgFileImport } from './OrgFileImport'
import { FILE_NAMES, FILE_WHAT, botsLine } from './file-guide-copy'

type LinkPanel = 'grok' | 'template' | 'manual' | 'existing'

export function LinkCompany({
  slug,
  seats,
  onImported,
  onAddSeat,
  onAddExisting,
  onCompanyFields,
  defaultOpen = null,
}: {
  slug: string
  seats: SeatDocument[]
  onImported: () => Promise<void>
  /** Add a seat, as on the org chart: a person or a bot. */
  onAddSeat: () => void
  onAddExisting: () => void
  onCompanyFields: () => void
  /** Organization Overview leaves every panel closed. The empty-organization start screen opens the first. */
  defaultOpen?: LinkPanel | null
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
  const locked = importLocked(seats)
  const seatsAt = seatsFolder(folder)

  function pick(id: LinkPanel, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setOpen((current) => (current === id ? null : id))
  }

  return (
    <section className="link-company connect-grok" aria-labelledby="link-company-title">
      <h2 id="link-company-title"><span className="step-label">Step 2</span>How to link your organization to BotsEverywhere</h2>
      {locked ? null : <span className="connect-badge"><i aria-hidden="true" />{WORK_CHART_LOCKED}</span>}
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
            <BotsFileImport slug={slug} mode="grok" onImported={onImported} />
          </Panel>
          <Panel id="import-from-template" option={2} title="Import from a template .json" badge="build an organization from an interview with an LLM" open={open === 'template'} onPick={(event) => pick('template', event)}>
            <BotsFileImport slug={slug} mode="template" onImported={onImported} />
          </Panel>
          <Panel id="add-manually" option={3} title="Add your organization manually" open={open === 'manual'} onPick={(event) => pick('manual', event)}>
            <p className="overview-note">Fill in the organization details below, then hire bots from the directory or add an existing bot.</p>
            <div className="dir-actions">
              <Button variant="secondary" href="#/directory">Bot directory</Button>
              <Button variant="secondary" type="button" onClick={onAddExisting}>Add existing bot</Button>
              <Button variant="secondary" type="button" onClick={onCompanyFields}>Organization fields</Button>
            </div>
          </Panel>
          <Panel id="import-existing-org" option={4} title="Import an existing organization .json" badge="describe your organization to an LLM" open={open === 'existing'} onPick={(event) => pick('existing', event)}>
            <OrgFileImport slug={slug} seats={seats} onImported={onImported} />
          </Panel>
        </>
      )}
    </section>
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
