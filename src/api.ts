export type Role = 'owner' | 'editor' | 'viewer'

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export interface TeamSummary {
  id: string
  name: string
  role: Role
  slackTeamId: string | null
}

export interface SessionPayload {
  user: SessionUser | null
  teams: TeamSummary[]
  csrfToken: string
  authEnabled: boolean
}

export interface IssuedLinks {
  editUrl: string
  viewUrl: string
}

export interface SeatRecord {
  id: string
  name: string
  role: string
  botSlug: string | null
  humanOwner: string
  sortOrder: number
  kind?: 'human' | 'bot' | 'system'
  reportsTo?: string | null
  owns?: string
  may?: string
  mustAskBefore?: string
  doneWhen?: string
  provenance?: { owns: string; may: string; mustAskBefore: string; doneWhen: string }
}

export interface MilestoneRecord {
  id: string
  title: string
  done: boolean
  dueOn: string | null
}

export interface GoalRecord {
  id: string
  title: string
  dueOn: string
  sortOrder: number
  milestones: MilestoneRecord[]
  progress: { done: number; total: number }
}

export interface ActivityRecord {
  id: string
  at: string
  summary: string
  commitSha: string
}

export interface WorkStep {
  id: string
  workstreamId: string
  name: string
  level: number
  executorSeatId: string
  sortOrder: number
}

export interface WorkChart {
  seats: SeatRecord[]
  workstreams: {
    id: string
    outcome: string
    ownerSeatId: string
    kind: string
    triggerSource: string
    triggerLabel: string
  }[]
  steps: WorkStep[]
  handoffs: { id: string; workstreamId: string; fromStepId: string; toStepId: string }[]
  checkpoints: { id: string; stepId: string; rule: string; approverSeatId: string; required: boolean }[]
}

let csrfToken = ''
let shareToken = ''
let ownerToken = ''

export function setShareToken(token: string) {
  shareToken = token
}

/** In-memory only. The owner token stays in the URL hash, not in storage. */
export function setOwnerToken(token: string) {
  ownerToken = token
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function setCsrf(token: string) {
  if (token) csrfToken = token
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET'
  const headers = new Headers()
  if (init?.body !== undefined) headers.set('content-type', 'application/json')
  if (shareToken) headers.set('x-share-token', shareToken)
  if (ownerToken) headers.set('x-owner-token', ownerToken)
  if (method !== 'GET' && method !== 'HEAD') {
    if (!csrfToken) throw new ApiError('Refresh the page and try again.', 403)
    headers.set('x-csrf-token', csrfToken)
  }
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError('The API is not reachable. Start it with npm run dev:api.', 0)
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string; csrfToken?: string }
  if (typeof data.csrfToken === 'string') csrfToken = data.csrfToken
  if (!response.ok) throw new ApiError(data.error || 'Request failed.', response.status)
  return data as T
}
