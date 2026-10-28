import type { RoutineBoard as Board } from '../../server/src/routine-board-types.ts'
import { startLine } from './bot-profile-copy'
import { boardGroups, handoffLine, sourceLine, whenLine } from './routine-board-copy'

/** Routines and handoffs in Grok Bot, on the Work Chart: grouped by bot, each routine with its state, schedule, and runs. */
export function RoutineBoard({ board }: { board: Board }) {
  const { shown, nothing, waiting } = boardGroups(board)
  return (
    <section className="routine-board" aria-labelledby="routine-board-title">
      <h2 id="routine-board-title">Routines and handoffs in Grok Bot</h2>
      <p className="overview-note">What each bot runs on its own in Grok Bot, and the work it hands on. Only a bot can see these for itself, so each one sends its own profile.</p>
      {shown.map((bot) => (
        <div className="routine-bot" key={bot.slug}>
          <div className="routine-bot-head">
            <strong>{bot.title}</strong>
            <span>{sourceLine(bot)}</span>
          </div>
          {bot.routines.length ? (
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
          ) : null}
          {bot.sends?.length ? (
            <div className="routine-handoffs">
              <strong>Sends:</strong>
              <ul>{bot.sends.map((handoff, index) => <li key={index}>{handoffLine(handoff)}</li>)}</ul>
            </div>
          ) : null}
          {bot.receives?.length ? (
            <div className="routine-handoffs">
              <strong>Gets work from:</strong>
              <ul>{bot.receives.map((handoff, index) => <li key={index}>{handoffLine(handoff)}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ))}
      {nothing.length ? <p className="routine-others"><strong>No routines or handoffs:</strong> {nothing.join(', ')}</p> : null}
      {waiting.length ? <p className="routine-others"><strong>Waiting for their profile:</strong> {waiting.join(', ')}</p> : null}
    </section>
  )
}
