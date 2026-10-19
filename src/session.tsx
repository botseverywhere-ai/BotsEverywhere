import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setCsrf, type SessionPayload, type SessionUser, type TeamSummary } from './api'
import { SessionContext } from './sessionContext'

const ACTIVE_KEY = 'be-active-team'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [authEnabled, setAuthEnabled] = useState(false)
  const [activeTeamId, setActiveTeamId] = useState(() => readActive())

  const refresh = useCallback(async () => {
    try {
      const data = await api<SessionPayload>('/api/session')
      setCsrf(data.csrfToken)
      setUser(data.user)
      setTeams(data.teams)
      setAuthEnabled(data.authEnabled === true)
    } catch {
      setUser(null)
      setTeams([])
      setAuthEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the session is fetched from the API
    void refresh()
  }, [refresh])

  const chooseTeam = useCallback((id: string) => {
    setActiveTeamId(id)
    try {
      if (id) sessionStorage.setItem(ACTIVE_KEY, id)
      else sessionStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* private mode */
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} })
    } catch {
      /* session may already be gone */
    }
    setUser(null)
    setTeams([])
    chooseTeam('')
    await refresh()
  }, [chooseTeam, refresh])

  const value = useMemo(
    () => ({ user, teams, loading, authEnabled, activeTeamId, refresh, chooseTeam, logout }),
    [user, teams, loading, authEnabled, activeTeamId, refresh, chooseTeam, logout],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

function readActive(): string {
  try {
    return sessionStorage.getItem(ACTIVE_KEY) ?? ''
  } catch {
    return ''
  }
}
