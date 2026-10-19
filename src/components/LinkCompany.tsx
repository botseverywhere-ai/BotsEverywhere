import { useState, type ReactNode, type MouseEvent } from 'react'
import type { SeatDocument } from '../../server/src/org-files.ts'
import { Button } from './Button'
import { BotsFileImport } from './BotsFileImport'

type LinkPanel = 'grok' | 'template' | 'manual'

export function LinkCompany({
  slug,
  seats,
  onImported,
  onAddExisting,
  onCompanyFields,
  defaultOpen = null,
}: {
  slug: string
  seats: SeatDocument[]
  onImported: () => Promise<void>
  onAddExisting: () => void
  onCompanyFields: () => void
  /** Organization Overview leaves every panel closed. The empty-organization start screen opens the first. */
  defaultOpen?: LinkPanel | null
}) {
  const [open, setOpen] = useState<LinkPanel | null>(defaultOpen)

  function pick(id: LinkPanel, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    setOpen((current) => (current === id ? null : id))
  }

  return (
    <section className="link-company dir-page" aria-labelledby="link-company-title">
      <h2 id="link-company-title"><span className="step-label">Step 2</span>How to link your organization to BotsEverywhere</h2>
      <p className="overview-note">Pick one way to fill this organization. You can do this before or after Step 1.</p>
      <Panel id="import-from-grok" option={1} title="Import from your Grok Bot" open={open === 'grok'} onPick={(event) => pick('grok', event)}>
        <BotsFileImport slug={slug} seats={seats} mode="grok" onImported={onImported} />
      </Panel>
      <Panel id="import-from-template" option={2} title="Import from a template .json" open={open === 'template'} onPick={(event) => pick('template', event)}>
        <BotsFileImport slug={slug} seats={seats} mode="template" onImported={onImported} />
      </Panel>
      <Panel id="add-manually" option={3} title="Add your organization manually" open={open === 'manual'} onPick={(event) => pick('manual', event)}>
        <p className="overview-note">Fill in the organization details below, then hire bots from the directory or add an existing bot.</p>
        <div className="dir-actions">
          <Button variant="secondary" href="#/directory">Bot directory</Button>
          <Button variant="secondary" type="button" onClick={onAddExisting}>Add existing bot</Button>
          <Button variant="secondary" type="button" onClick={onCompanyFields}>Organization fields</Button>
        </div>
      </Panel>
    </section>
  )
}

function Panel({
  id,
  option,
  title,
  open,
  onPick,
  children,
}: {
  id: string
  option: number
  title: string
  open: boolean
  onPick: (event: MouseEvent<HTMLElement>) => void
  children: ReactNode
}) {
  return (
    <details className="link-panel" id={id} open={open}>
      <summary onClick={onPick}>
        <span><span className="link-panel-option">Option {option}</span>{title}</span>
        <span className="grok-chevron" aria-hidden="true" />
      </summary>
      <div className="link-panel-body">{children}</div>
    </details>
  )
}
