import { useEffect, useState } from 'react'
import type { RoutineBoard } from '../../server/src/routine-board-types.ts'

/**
 * What each bot has in Grok Bot, as each bot reports it: its routines, the skills turned on for it, and the work it hands
 * on or gets. Read again whenever the page's sync status is, so a bot's new profile shows as soon as the Connector
 * records it. Your own organizations only.
 */
export function useRoutineBoard(orgId: string, refresh: unknown, enabled: boolean): RoutineBoard | null {
  const [board, setBoard] = useState<RoutineBoard | null>(null)
  useEffect(() => {
    if (!enabled) return
    let stop = false
    fetch(`/api/orgs/${orgId}/routines`)
      .then((response) => (response.ok ? (response.json() as Promise<RoutineBoard>) : null))
      .then((body) => {
        if (!stop && body) setBoard(body)
      })
      .catch(() => undefined)
    return () => {
      stop = true
    }
  }, [orgId, refresh, enabled])
  return board
}
