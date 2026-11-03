import { Button } from './Button'

/**
 * Where Performance's numbers come from, in the shape of Step 2 on Connect bots: whether the Connector runs, how many
 * bots have written their own report, and, while asks wait, the one line to say in the Connector's chat.
 */
export function PerformanceStatus({
  orgSlug,
  connected,
  reported,
  total,
  waitingAsks,
  onAsk,
}: {
  orgSlug: string
  /** The Connector has written connector.json at least once. */
  connected: boolean
  /** Bots whose own profile report is on file. */
  reported: number
  /** Active bots in the organization, the Connector left out. */
  total: number
  /** Profile asks on the Connector's list, which only go out from its chat. */
  waitingAsks: number
  onAsk: () => void
}) {
  const all = total > 0 && reported >= total
  return (
    <section className="connect-grok performance-status" aria-label="Where these numbers come from">
      <dl className="connect-facts">
        <dt>Status</dt>
        <dd className="connect-status">
          {connected ? (
            <>
              <span className="connect-badge is-connected"><i aria-hidden="true" />Connected</span>
              <span className="connect-status-detail">Created, Times used, Last active, and Apps used come from Grok Bot on every Connector run.</span>
            </>
          ) : (
            <>
              <span className="connect-badge"><i aria-hidden="true" />Not connected</span>
              <span className="connect-status-detail"><a href={`#/org/${orgSlug}/connect-bots`}>Connect Grok Bot</a> first: until the Connector runs, nothing here fills in.</span>
            </>
          )}
        </dd>
        <dt>Bot reports</dt>
        <dd className="connect-status">
          <span className={all ? 'connect-badge is-connected' : 'connect-badge'}><i aria-hidden="true" />{all ? `All ${total} bots reported` : `${reported} of ${total} bots reported`}</span>
          <span className="connect-status-detail">{waitingAsks ? `${waitingAsks === 1 ? '1 ask goes' : `${waitingAsks} asks go`} out on the Connector's next run. ` : ''}Automated tasks done and Skills come from each bot&apos;s own report. Bots report on their own when they next run; Get the bots&apos; profiles asks all of them now.</span>
          {waitingAsks ? null : <Button variant="secondary" type="button" onClick={onAsk}>Get the bots&apos; profiles</Button>}
        </dd>
      </dl>
    </section>
  )
}
