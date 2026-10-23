import { useState } from 'react'
import type { SyncStatus } from '../../server/src/grok-sync.ts'
import { CONNECTOR_BOT_NAME, connectorPrompt } from '../../server/src/connector-prompt.ts'
import { DEFAULT_SYNC_MINUTES, everyLabel, joinSyncMinutes, splitSyncMinutes, validSyncMinutes, type SyncUnit } from '../../server/src/connector-timing.ts'
import { CopyPromptButton } from '../directory/prompt-actions'
import { Button } from './Button'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'
import { CONNECTOR_FILES_NOTE, connectorFiles, connectorState, intervalWarning, type ConnectorState } from './sync-copy'
import { connectorStatusFile } from './file-guide-copy'

const BADGE: Record<ConnectorState, string> = {
  checking: 'Checking',
  connected: 'Connected',
  never: 'Not connected',
  stale: 'Stopped',
  broken: 'Error',
  unknown: 'Unknown',
}

/** The part after the badge: "last run 3 min ago", or the whole sentence when there is no short form. */
function statusDetail(line: string): string {
  const at = line.indexOf(' · ')
  return at === -1 ? line : line.slice(at + 3)
}

/** Closed while the interval is locked; open on Change. */
function LockIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d={open ? 'M5.5 7V4.5a2.5 2.5 0 0 1 4.9-.7' : 'M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Step 1 on Connect bots. One Connector per copy of BotsEverywhere serves every organization in it. */
export function ConnectGrok({ status, editable, onIntervalSaved }: { status: SyncStatus | null; editable: boolean; onIntervalSaved?: () => Promise<void> }) {
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const project = status?.project
  // The writer knows the real folder of this copy; until it answers there is nothing safe to hand Grok Bot.
  const ready = Boolean(project?.orgsFolder)
  const name = project?.connectorName || CONNECTOR_BOT_NAME
  // How often the Connector runs. Locked until Change; while editing, the prompt follows the typed value.
  const saved = project?.syncMinutes ?? DEFAULT_SYNC_MINUTES
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<SyncUnit>('minutes')
  const [busy, setBusy] = useState(false)
  const typed = editing ? validSyncMinutes(joinSyncMinutes(amount, unit)) : saved
  const minutes = typed ?? saved
  const shown = editing ? { amount, unit } : { ...splitSyncMinutes(saved), amount: String(splitSyncMinutes(saved).amount) }
  const prompt = connectorPrompt({ id: project?.id ?? '', orgsFolder: project?.orgsFolder ?? '', syncMinutes: minutes, timeZone: project?.timeZone ?? '', windows: project?.windows ?? false })
  const { state, line } = connectorState(status)
  const statusFile = connectorStatusFile(status)

  function change() {
    const split = splitSyncMinutes(saved)
    setAmount(String(split.amount))
    setUnit(split.unit)
    setNotice(null)
    setEditing(true)
  }

  async function save() {
    if (typed === null || busy) return
    setBusy(true)
    try {
      const response = await fetch('/api/project/sync-minutes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minutes: typed }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setNotice(saveNotice(false, body.error || 'Could not save the interval.'))
        return
      }
      setEditing(false)
      if (onIntervalSaved) await onIntervalSaved()
      setNotice(saveNotice(true, `Saved. Copy the prompt and paste it into ${name} in Grok Bot, so it runs every ${everyLabel(typed)}.`))
    } catch {
      setNotice(saveNotice(false, 'Saving is off. Restart npm run dev, then try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="connect-grok" aria-labelledby="connect-grok-title">
      <h2 id="connect-grok-title"><span className="step-label">Step 1</span>Connect Grok Bot</h2>
      <p>
        Do this once for this copy of BotsEverywhere. One bot in Grok Bot, the Connector, links Grok Bot to every organization here.
        Until it runs, nothing you build here reaches Grok Bot.
      </p>
      <dl className="connect-facts">
        <dt>Connector name</dt>
        <dd><strong>{name}</strong></dd>
        <dt>Folder it uses</dt>
        <dd><code>{project?.orgsFolder || 'Waiting for the file writer…'}</code></dd>
        <dt>Status file</dt>
        <dd className="connect-file">
          <code title={statusFile.path}>{statusFile.name}</code>
          <span>{statusFile.what}</span>
          {statusFile.fact ? <span className="connect-file-fact">{statusFile.fact}</span> : null}
        </dd>
        <dt>Status</dt>
        <dd className="connect-status">
          <span className={`connect-badge is-${state}`}><i aria-hidden="true" />{BADGE[state]}</span>
          <span className="connect-status-detail">{statusDetail(line)}</span>
        </dd>
      </dl>
      <ol className="connect-steps">
        <li>Copy the Connector prompt below.</li>
        <li>Paste it into Grok Bot. Grok Bot creates <strong>{name}</strong> and runs it every {everyLabel(saved)}.</li>
        <li>Come back here. The status turns green after its first run, and <strong>Sync with Grok Bot</strong> starts showing changes.</li>
      </ol>
      <p className="overview-note">
        The prompt changed: the Connector now reports each bot's skills and public link, creates new bots with the skills and routines from their Profile, and still leaves deleting bots to you. If your Connector already runs, paste this prompt into it once more.
      </p>
      {editable && ready ? (
        <div className="connect-interval">
          <label htmlFor="connect-interval-amount">Runs every</label>
          <div className={editing ? 'connect-interval-row' : 'connect-interval-row is-locked'}>
            {editing ? null : <span className="connect-interval-lock" title="Locked. Choose Change to edit."><LockIcon open={false} /></span>}
            <input
              id="connect-interval-amount"
              className="text-input"
              type="number"
              min={1}
              inputMode="numeric"
              value={shown.amount}
              disabled={!editing || busy}
              onChange={(event) => setAmount(event.target.value)}
            />
            <select className="text-input" aria-label="Unit" value={shown.unit} disabled={!editing || busy} onChange={(event) => setUnit(event.target.value as SyncUnit)}>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            {editing ? (
              <>
                <Button variant="primary" type="button" disabled={typed === null || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
                <Button variant="secondary" type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
              </>
            ) : (
              <Button variant="secondary" type="button" onClick={change}><LockIcon open />Change</Button>
            )}
          </div>
          <p className={typed === null ? 'grok-status-warning' : 'overview-note'} role={typed === null ? 'alert' : undefined}>
            {typed === null
              ? 'Pick between 15 minutes and 7 days.'
              : editing
                ? `The Connector will sync with Grok Bot every ${everyLabel(minutes)}. Save, then copy the prompt.`
                : `The Connector syncs with Grok Bot every ${everyLabel(saved)}. Once your organizations are set up, it can run less often.`}
          </p>
          {!editing && intervalWarning(project) ? <p className="grok-status-warning" role="status">{intervalWarning(project)}</p> : null}
        </div>
      ) : null}
      {editable && ready ? (
        editing ? null : <CopyPromptButton text={prompt} label="Copy Connector prompt" onCopied={(message) => setNotice(saveNotice(true, message))} />
      ) : (
        <p className="overview-note">{editable ? 'The prompt appears once the file writer answers. If it does not, restart npm run dev.' : 'Copy this organization into your own folder to connect it.'}</p>
      )}
      {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
      <details className="link-panel">
        <summary>
          <span className="connect-prompt-summary">
            Show the prompt
            {state === 'connected' ? (
              <span className="connect-badge is-connected"><i aria-hidden="true" />You are connected.</span>
            ) : null}
          </span>
          <span className="grok-chevron" aria-hidden="true" />
        </summary>
        <div className="link-panel-body">
          <pre className="dir-prompt">{prompt}</pre>
        </div>
      </details>
      <details className="link-panel">
        <summary>
          <span className="connect-prompt-summary">Files the Connector uses</span>
          <span className="grok-chevron" aria-hidden="true" />
        </summary>
        <div className="link-panel-body">
          <p className="overview-note">{CONNECTOR_FILES_NOTE}</p>
          <div className="backup-table-wrap">
            <table className="backup-table connector-files">
              <thead>
                <tr><th scope="col">File</th><th scope="col">Who writes it</th><th scope="col">What it holds</th></tr>
              </thead>
              <tbody>
                {connectorFiles(project?.orgsFolder ?? '', status?.folder ?? '', project?.id ?? '').map((row) => (
                  <tr key={row.path}>
                    <th scope="row"><code>{row.path}</code></th>
                    <td>{row.writer}</td>
                    <td>{row.holds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
      <p className="overview-note">
        Several copies of BotsEverywhere on this computer? Each has its own id and folder, so paste the prompt from the copy you want Grok Bot to use.
        Already have an older {CONNECTOR_BOT_NAME} in Grok Bot? Delete it there once this one has run, so only one Connector writes here.
      </p>
    </section>
  )
}
