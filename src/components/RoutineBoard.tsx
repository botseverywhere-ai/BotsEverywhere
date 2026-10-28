import { useEffect, useState } from 'react'
import type { RoutineBoard as Board } from '../../server/src/routine-board-types.ts'
import { startLine } from './bot-profile-copy'
import { boardGroups, sourceLine, whenLine } from './routine-board-copy'

/**
 * Routines in Grok Bot, on the Work Chart: what each bot runs on its own, grouped by bot, with its state, its schedule
 * in words, and its last and next run. It reads again whenever the page's sync status does, so a bot's new list shows
 * as soon as the Connector records it.
 */
export function RoutineBoard({ orgId, refresh }: { orgId: string; refresh: unknown }) {
  const [board, setBoard] = useState<Board | null>(null)

  useEffect(() => {
    let stop = false
    fetch(`/api/orgs/${orgId}/routines`)
      .then((response) => (response.ok ? (response.json() as Promise<Board>) : null))
      .then((body) => {
        if (!stop && body) setBoard(body)
      })
      .catch(() => undefined)
    return () => {
      stop = true
    }
  }, [orgId, refresh])

  if (!board) return null
  const { withRoutines, noRoutines, waiting } = boardGroups(board)
  return (
    <section className="routine-board" aria-labelledby="routine-board-title">
      <h2 id="routine-board-title">Routines in Grok Bot</h2>
      <p className="overview-note">What each bot runs on its own in Grok Bot. Only a bot can read its routines, so each one sends its own list.</p>
      {withRoutines.map((bot) => (
        <div className="routine-bot" key={bot.slug}>
          <div className="routine-bot-head">
            <strong>{bot.title}</strong>
            <span>{sourceLine(bot)}</span>
          </div>
          <ul className="routine-list">
            {bot.routines.map((routine) => (
              <li key={routine.name} className={routine.enabled === false ? 'routine-card is-paused' : 'routine-card'}>
                <div className="routine-card-head">
                  <span className="routine-name">{routine.name}</span>
                  <span className={routine.enabled === false ? 'routine-state is-paused' : 'routine-state is-active'}>{routine.enabled === false ? 'Paused' : 'Active'}</span>
                </div>
                <p>{startLine(routine)}</p>
                <p className="routine-when">{whenLine(routine)}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {noRoutines.length ? <p className="routine-others"><strong>No routines:</strong> {noRoutines.join(', ')}</p> : null}
      {waiting.length ? <p className="routine-others"><strong>Waiting for their list:</strong> {waiting.join(', ')}</p> : null}
    </section>
  )
}
