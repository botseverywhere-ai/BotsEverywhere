import { APP_MODE } from '../mode'
import { useSession } from '../sessionContext'
import { Button } from './Button'

export function AccountMenu({ context }: { context: 'team' | 'product' }) {
  const { user, loading, logout, authEnabled } = useSession()
  if (loading) return <span className="demo-pill">Checking session…</span>
  if (!user) {
    return authEnabled ? (
      <Button variant="secondary"  href="#signin">
        Sign in
      </Button>
    ) : (
      APP_MODE === 'sqlite' ? (
        <Button variant="secondary"  href="#teams" data-account={context}>
          Create a team
        </Button>
      ) : APP_MODE === 'showcase' ? (
        <Button variant="secondary"  href="#docs" data-account={context}>
          Get the open source copy
        </Button>
      ) : (
        <Button variant="secondary"  href="#org" data-account={context}>
          Your org
        </Button>
      )
    )
  }
  return (
    <>
      <a className="who" href="#teams">
        {user.email}
      </a>
      <Button variant="secondary" type="button"  onClick={() => void logout()}>
        Sign out
      </Button>
    </>
  )
}
