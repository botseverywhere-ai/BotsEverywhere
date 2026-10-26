import { useRef, useState } from 'react'
import type { SyncPlan, SyncRow, SyncStatus } from '../../server/src/grok-sync.ts'
import { grokSnapshotPrompt, syncNowPrompt } from '../content/grok-snapshot-prompt'
import { CopyPromptButton } from '../directory/prompt-actions'
import { orgFolder } from '../org/folder-path'
import { Button } from './Button'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'
import { formatShortDate } from '../../server/src/bot-metrics.ts'
import { activeBotCount, botLimitLine, outgoing, overBotLimit, rowLine, statusLine } from './sync-copy'
import { DEFAULT_SYNC_MINUTES, everyLabel } from '../../server/src/connector-timing.ts'
import type { SeatDocument } from '../../server/src/org-files.ts'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then sync again.'
const STALE = 'The snapshot changed. Review it again.'

type Source = { kind: 'file' } | { kind: 'json'; json: string; status: SyncStatus }

export function SyncDrawer({
  orgSlug,
  status,
  seats,
  onClose,
  onRefresh,
  onApplied,
}: {
  orgSlug: string
  status: SyncStatus | null
  seats: SeatDocument[]
  onClose: () => void
  onRefresh: () => Promise<void>
  onApplied: (message: string) => Promise<void>
}) {
  const [source, setSource] = useState<Source>({ kind: 'file' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [adopt, setAdopt] = useState<Set<string>>(() => new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const shown = source.kind === 'json' ? source.status : status
  const plan = shown?.plan ?? null
  const incoming = plan?.writes ?? 0
  const project = status?.project
  // Requests live beside the snapshot, so they come from the folder status even while a pasted file is previewed.
  const going = outgoing(plan, status?.requests ?? [], seats)
  const renamed = project?.renamed ?? {}
  const unassigned = project?.unassigned ?? []
  // One Grok Bot account serves every org in this folder, so the limit counts them all.
  const bots = project ? project.bots : activeBotCount(seats)
  const scope = project ? 'project' : 'organization'
  // Ticked bots join the ones Grok Bot already runs or was asked for.
  const inGrok = Math.max(0, bots - going.ready.length)
  const limitOver = picked.size > 0 ? overBotLimit(inGrok, picked.size) : overBotLimit(bots)
  const limitLine = picked.size > 0 ? botLimitLine(inGrok, picked.size, scope) : botLimitLine(bots, 0, scope)
  const oneOffPrompt = grokSnapshotPrompt(shown?.folder || orgFolder(orgSlug))
  const connector = project?.connectorName || 'Connector - BotsEverywhere'

  function toggleAdopt(name: string) {
    setAdopt((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggle(slug: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  /** Applies what came from Grok Bot, then asks the Connector for each ticked bot. */
  async function sync() {
    if (busy || (incoming === 0 && picked.size === 0 && adopt.size === 0)) return
    setBusy(true)
    setNotice(null)
    const parts: string[] = []
    if (incoming > 0) {
      const applied = await confirm()
      if (applied === null) {
        setBusy(false)
        return
      }
      parts.push(applied)
    }
    const sent: string[] = []
    const failed: string[] = []
    for (const slug of picked) {
      const name = going.ready.find((item) => item.slug === slug)?.name ?? slug
      try {
        const response = await fetch(`/api/orgs/${orgSlug}/grok/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ seat: slug }),
        })
        if (response.ok) sent.push(name)
        else failed.push(name)
      } catch {
        failed.push(name)
      }
    }
    if (sent.length) parts.push(`Sent ${sent.join(', ')} to the Connector. Grok Bot creates ${sent.length === 1 ? 'it' : 'them'} on its next run, or right away if you use Run the Connector now`)
    if (failed.length) parts.push(`Could not send ${failed.join(', ')}. Restart npm run dev and sync again.`)
    if (adopt.size) {
      try {
        const response = await fetch(`/api/orgs/${orgSlug}/sync/adopt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ names: [...adopt] }),
        })
        const result = response.ok ? (await response.json()) as { added?: string[] } : null
        if (result?.added?.length) parts.push(`Added ${result.added.join(', ')} from Grok Bot`)
        else parts.push(response.ok ? 'Those bots are already in this organization' : 'Could not add those bots. Restart npm run dev and sync again.')
      } catch {
        parts.push('Could not add those bots. Restart npm run dev and sync again.')
      }
    }
    setPicked(new Set())
    setAdopt(new Set())
    setBusy(false)
    await onApplied(parts.join('. '))
  }

  /** The incoming half. Returns the summary line, or null when nothing was written. */
  async function confirm(): Promise<string | null> {
    if (!plan || plan.writes === 0) return null
    try {
      const body = source.kind === 'json'
        ? { source: 'json', json: source.json }
        : { source: 'file', stamp: shown?.snapshot?.stamp ?? '' }
      const response = await fetch(`/api/orgs/${orgSlug}/sync/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await response.text()
      const result = text.trimStart().startsWith('{') ? JSON.parse(text) as { summary?: string; errors?: unknown; error?: string } : {}
      if (response.status === 409) {
        await onRefresh()
        setNotice(saveNotice(false, STALE))
        return null
      }
      if (!response.ok) {
        const reasons = Array.isArray(result.errors) ? result.errors.map(String).join(' ') : result.error || 'Could not sync.'
        setNotice(saveNotice(false, reasons, 'Not synced'))
        return null
      }
      const skipped = Array.isArray(result.errors)
        ? result.errors.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as { name?: string; error?: string }
          return [`Skipped ${row.name || 'a row'}: ${row.error || 'could not sync it.'}`]
        }).join(' ')
        : ''
      return skipped ? `Synced: ${result.summary ?? ''}. ${skipped}` : `Synced: ${result.summary ?? ''}`
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not synced'))
      return null
    }
  }

  async function preview(file: File) {
    setNotice(null)
    const json = await file.text()
    try {
      const response = await fetch(`/api/orgs/${orgSlug}/sync/preview`, { method: 'POST', body: json })
      const text = await response.text()
      const result = text.trimStart().startsWith('{') ? JSON.parse(text) as SyncStatus & { errors?: string[] } : null
      if (!response.ok || !result) {
        setNotice(saveNotice(false, result?.errors?.join(' ') || 'Could not read that file.', 'Not imported'))
        return
      }
      setSource({ kind: 'json', json, status: result })
    } catch {
      setNotice(saveNotice(false, SAVING_OFF, 'Not imported'))
    }
  }

  return (
    <div className="be-scrim" onClick={busy ? undefined : onClose}>
      <aside className="be-drawer be-hire sync-drawer" role="dialog" aria-labelledby="sync-title" onClick={(event) => event.stopPropagation()}>
        <div className="be-hire-scroll">
          <header className="be-hire-head">
            <h2 id="sync-title">Sync with Grok Bot</h2>
            <button type="button" className="be-icon" onClick={onClose} aria-label="Close" disabled={busy}>
              ×
            </button>
          </header>
          <p className="overview-note">
            {connector} moves files between Grok Bot and every organization in this folder. Paste its prompt from Connect bots into Grok Bot once, and this drawer fills in by itself every {everyLabel(project?.syncMinutes ?? DEFAULT_SYNC_MINUTES)}.
          </p>
          <p className="overview-note">{shown ? statusLine(shown, orgSlug) : 'Checking for a snapshot…'}</p>
          <div className="sync-run-now">
            <p className="overview-note">
              Do not want to wait for the next run? Copy this message, paste it into Grok Bot, and the Connector runs right away. This drawer updates when it finishes.
            </p>
            <CopyPromptButton text={syncNowPrompt(project?.connectorName ?? '')} label="Run the Connector now" onCopied={(message) => setNotice(saveNotice(true, message))} />
          </div>
          <p className="overview-note">
            <a href={`#/org/${orgSlug}/connect-bots`}>Copy the Connector prompt on Connect bots</a>
          </p>
          {source.kind === 'json' ? (
            <p className="overview-note">
              Previewing an imported file.{' '}
              <Button variant="secondary" type="button" onClick={() => setSource({ kind: 'file' })}>Back to the snapshot</Button>
            </p>
          ) : null}
          <section className="sync-side" aria-labelledby="sync-in">
            <h3 id="sync-in" className="sync-side-title">Coming from Grok Bot</h3>
            <p className="overview-note">
              Grok Bot&apos;s numbers (last active, runs, tasks, routines) apply on their own on every Connector run. Sync is for new bots, bots that left or came back, links, names, card fills, and processes.
            </p>
            {plan ? <Preview plan={plan} /> : <p className="overview-note">Nothing until the Connector writes a snapshot.</p>}
            {unassigned.length ? (
              <section className="sync-group">
                <h3>In Grok Bot, no organization ({unassigned.length})</h3>
                <p className="overview-note">These bots run in Grok Bot but belong to no organization in this folder. Tick the ones to add to this organization.</p>
                <ul className="sync-picks">
                  {unassigned.map((name) => (
                    <li key={name}>
                      <label>
                        <input type="checkbox" checked={adopt.has(name)} disabled={busy} onChange={() => toggleAdopt(name)} /> {name}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </section>
          <section className="sync-side" aria-labelledby="sync-out">
            <h3 id="sync-out" className="sync-side-title">Going to Grok Bot</h3>
            <p className={limitOver ? 'save-off' : 'overview-note'} role={limitOver ? 'alert' : undefined}>{limitLine}</p>
            {going.waiting.length === 0 && going.ready.length === 0 ? <p className="overview-note">{activeBotCount(seats) ? 'Every bot in the org chart is in Grok Bot.' : 'This organization has no bots yet.'}</p> : null}
            {going.waiting.length ? (
              <section className="sync-group">
                <h3>Waiting for the Connector ({going.waiting.length})</h3>
                <ul className="sync-picks">
                  {going.waiting.map((item) => <li key={item.slug}>{item.kind === 'update' ? (
                    <>
                      {item.items.length ? null : <i className="be-pulse" aria-hidden="true" />}<strong>{item.name}</strong> · asked {formatShortDate(item.requestedAt)}, sent on the Connector&apos;s next run
                      {item.items.length ? <ul className="sync-update-items">{item.items.map((change, index) => <li key={index}><i className="be-pulse" aria-hidden="true" />{change}</li>)}</ul> : null}
                    </>
                  ) : <><i className="be-pulse" aria-hidden="true" />{item.name} → asked {formatShortDate(item.requestedAt)}, created on the Connector&apos;s next run</>}</li>)}
                </ul>
              </section>
            ) : null}
            {going.ready.length ? (
              <section className="sync-group">
                <h3>Not in Grok Bot ({going.ready.length})</h3>
                <p className="overview-note">Tick the bots to create in Grok Bot. The Connector creates them on its next run.</p>
                <ul className="sync-picks">
                  {going.ready.map((item) => (
                    <li key={item.slug}>
                      <label>
                        <input type="checkbox" checked={picked.has(item.slug)} disabled={busy} onChange={() => toggle(item.slug)} /> {item.name}
                        {renamed[item.slug] ? <span className="sync-renamed"> → created as {renamed[item.slug]}, because another organization in this folder has a bot with this name</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </section>
          {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
          <details className="link-panel">
            <summary>
              <span>One-off snapshot without the Connector</span>
              <span className="grok-chevron" aria-hidden="true" />
            </summary>
            <div className="link-panel-body">
              <p className="overview-note">Paste this into a Grok Bot chat. It answers with the snapshot, or saves it into the folder if it can. Then import the file here, or wait for the drawer to pick it up.</p>
              <pre className="dir-prompt">{oneOffPrompt}</pre>
              <div className="dir-actions">
                <CopyPromptButton text={oneOffPrompt} onCopied={(message) => setNotice(saveNotice(true, message))} />
                <Button variant="secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Import snapshot file</Button>              </div>
              <input
                ref={fileRef}
                className="be-file"
                type="file"
                accept="application/json,.json"
                aria-label="Import snapshot file"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void preview(file)
                }}
              />
            </div>
          </details>
        </div>
        <footer className="be-hire-foot">
          <div className="dir-actions">
            <Button variant="primary" type="button" disabled={busy || (incoming === 0 && picked.size === 0 && adopt.size === 0)} onClick={() => void sync()}>
              {busy ? 'Syncing…' : 'Sync'}
            </Button>
            <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>Cancel</Button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

const GROUPS: { kind: SyncRow['kind']; title: string }[] = [
  { kind: 'new', title: 'New' },
  { kind: 'updated', title: 'Updated' },
  { kind: 'new-process', title: 'New processes' },
  { kind: 'schedule', title: 'Schedule warnings' },
  { kind: 'skipped', title: 'Skipped' },
]

function Preview({ plan }: { plan: SyncPlan }) {
  return (
    <div className="sync-preview">
      {GROUPS.map((group) => {
        const rows = plan.rows.filter((row) => row.kind === group.kind)
        if (!rows.length) return null
        return (
          <section className="sync-group" key={group.kind}>
            <h3>{group.title} ({rows.length})</h3>
            <ul>
              {rows.map((row, index) => <li key={`${row.kind}-${row.name}-${index}`}>{rowLine(row)}</li>)}
            </ul>
          </section>
        )
      })}
      <p className="overview-note">
        {plan.counts.unchanged} unchanged. {plan.writes === 0 ? 'Nothing to apply.' : `${plan.writes} ${plan.writes === 1 ? 'change' : 'changes'} to apply.`}
      </p>
    </div>
  )
}
