import { useState } from 'react'
import type { SyncStatus } from '../../server/src/grok-sync.ts'
import { CONNECTOR_BOT_NAME, connectorPrompt } from '../../server/src/connector-prompt.ts'
import { CopyPromptButton } from '../directory/prompt-actions'
import { SaveAlert } from './SaveAlert'
import { saveNotice, type SaveNotice } from './save-notice'
import { connectorState, type ConnectorState } from './sync-copy'

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

/** Step 1 on Connect bots. One Connector per copy of BotsEverywhere serves every organization in it. */
export function ConnectGrok({ status, editable }: { status: SyncStatus | null; editable: boolean }) {
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const project = status?.project
  // The writer knows the real folder of this copy; until it answers there is nothing safe to hand Grok Bot.
  const ready = Boolean(project?.orgsFolder)
  const name = project?.connectorName || CONNECTOR_BOT_NAME
  const prompt = connectorPrompt({ id: project?.id ?? '', orgsFolder: project?.orgsFolder ?? '' })
  const { state, line } = connectorState(status)

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
        <dt>Status</dt>
        <dd className="connect-status">
          <span className={`connect-badge is-${state}`}><i aria-hidden="true" />{BADGE[state]}</span>
          <span className="connect-status-detail">{statusDetail(line)}</span>
        </dd>
      </dl>
      <ol className="connect-steps">
        <li>Copy the Connector prompt below.</li>
        <li>Paste it into Grok Bot. Grok Bot creates <strong>{name}</strong> and runs it every 15 minutes.</li>
        <li>Come back here. The status turns green after its first run, and <strong>Sync with Grok Bot</strong> starts showing changes.</li>
      </ol>
      <p className="overview-note">
        The prompt now also deletes the retired bots you choose to delete from Grok Bot. If your Connector already runs, paste this prompt into it once more so it learns that.
      </p>
      {editable && ready ? (
        <CopyPromptButton text={prompt} label="Copy Connector prompt" onCopied={(message) => setNotice(saveNotice(true, message))} />
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
      <p className="overview-note">
        Several copies of BotsEverywhere on this computer? Each has its own id and folder, so paste the prompt from the copy you want Grok Bot to use.
        Already have an older {CONNECTOR_BOT_NAME} in Grok Bot? Delete it there once this one has run, so only one Connector writes here.
      </p>
    </section>
  )
}
