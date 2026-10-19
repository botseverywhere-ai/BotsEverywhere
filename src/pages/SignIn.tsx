import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../api'
import { useSession } from '../sessionContext'
import { Button } from '../components/Button'

export function SignIn() {
  const { refresh } = useSession()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(() => slackError())

  const back = readReturn()
  const slackReturn = back.startsWith('invite-') ? back : 'teams'

  async function sendCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/email/start', { method: 'POST', body: { email } })
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/auth/email/verify', { method: 'POST', body: { email, code } })
      await refresh()
      clearReturn()
      window.location.hash = back || 'teams'
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main" className="app-main view-fade">
      <div className="card auth-card">
        <p className="eyebrow">Passwordless</p>
        <h1>Sign in</h1>
        <p className="auth-lead">
          Optional account sign-in. Teams themselves need no account: create one and keep the edit link. Use a 6-digit email code, or continue with Slack. No password.
        </p>
        {error ? <p className="form-error">{error}</p> : null}
        <form onSubmit={sent ? verify : sendCode}>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="text-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {sent ? (
            <>
              <label className="field-label" htmlFor="code">
                6-digit code
              </label>
              <input
                id="code"
                className="text-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <p className="auth-note">The code expires in 10 minutes. In local dev it is printed in the API console.</p>
            </>
          ) : null}
          <Button variant="primary"  type="submit" disabled={busy}>
            {busy ? 'Working…' : sent ? 'Sign in' : 'Email me a code'}
          </Button>
        </form>
        <div className="auth-or">or</div>
        <Button variant="secondary"  href={`/api/auth/slack/start?return=${encodeURIComponent(slackReturn)}`}>
          Sign in with Slack
        </Button>
      </div>

      <section className="signin-extra" aria-labelledby="how-signin">
        <h2 id="how-signin">How it works</h2>
        <ol className="signin-steps">
          <li className="card signin-box">
            <span className="n">1</span>
            <p>Create a team with no account. You get an edit link and a view-only link.</p>
          </li>
          <li className="card signin-box">
            <span className="n">2</span>
            <p>Save the edit link. Anyone with it can rename the team and change seats. The view link is read-only.</p>
          </li>
          <li className="card signin-box">
            <span className="n">3</span>
            <p>This page is optional email or Slack sign-in, and only when AUTH_ENABLED is on. The demo runs without it.</p>
          </li>
        </ol>
      </section>

      <section className="signin-extra" aria-labelledby="why-secure">
        <h2 id="why-secure">Why it's secure</h2>
        <ul className="signin-secure">
          <li className="card signin-box">
            <p>No passwords. Team access is an unguessable link, and teams are never listed publicly.</p>
          </li>
          <li className="card signin-box">
            <p>The server stores only hashes of the links. A lost link cannot be recovered.</p>
          </li>
          <li className="card signin-box">
            <p>Anyone with the edit link can edit. Regenerate the links to revoke the old ones.</p>
          </li>
          <li className="card signin-box">
            <p>Team pages send noindex. Creating a team and writing to the API are rate-limited.</p>
          </li>
        </ul>
      </section>
    </main>
  )
}

function slackError(): string {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('error') === 'slack'
    ? 'Slack sign-in did not complete. Try the email code, or check the Slack app settings.'
    : ''
}

function readReturn(): string {
  try {
    return sessionStorage.getItem('be-return') ?? ''
  } catch {
    return ''
  }
}

function clearReturn() {
  try {
    sessionStorage.removeItem('be-return')
  } catch {
    /* private mode */
  }
}
