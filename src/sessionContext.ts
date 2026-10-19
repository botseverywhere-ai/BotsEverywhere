import { createContext, useContext } from 'react'
import type { SessionUser, TeamSummary } from './api'

export interface SessionState {
  user: SessionUser | null
  teams: TeamSummary[]
  loading: boolean
  authEnabled: boolean
  activeTeamId: string
  refresh: () => Promise<void>
  chooseTeam: (id: string) => void
  logout: () => Promise<void>
}

export const SessionContext = createContext<SessionState | null>(null)

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider is missing')
  return value
}
