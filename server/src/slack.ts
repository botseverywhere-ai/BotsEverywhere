export interface SlackProfile {
  email: string
  name: string
  slackUserId: string
  teamId: string
  teamName: string
}

export function slackAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
}): string {
  const url = new URL('https://slack.com/openid/connect/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('nonce', input.nonce)
  return url.toString()
}

export async function exchangeSlackCode(input: {
  fetchImpl: typeof fetch
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  })
  const response = await input.fetchImpl('https://slack.com/api/openid.connect.token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json()) as { ok?: boolean; access_token?: string; error?: string }
  if (!response.ok || !payload.ok || !payload.access_token) {
    throw new Error(payload.error || 'Slack token exchange failed')
  }
  return payload.access_token
}

export async function fetchSlackProfile(fetchImpl: typeof fetch, accessToken: string): Promise<SlackProfile> {
  const response = await fetchImpl('https://slack.com/api/openid.connect.userInfo', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok || payload.ok === false) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Slack profile failed')
  }
  const email = typeof payload.email === 'string' ? payload.email : ''
  const teamId = stringClaim(payload, 'https://slack.com/team_id')
  const teamName = stringClaim(payload, 'https://slack.com/team_name') || 'Slack workspace'
  const slackUserId = stringClaim(payload, 'https://slack.com/user_id') || stringClaim(payload, 'sub')
  const name = typeof payload.name === 'string' ? payload.name : email
  if (!email || !teamId || !slackUserId) throw new Error('Slack profile is missing email or workspace')
  return { email, name, slackUserId, teamId, teamName }
}

function stringClaim(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}
