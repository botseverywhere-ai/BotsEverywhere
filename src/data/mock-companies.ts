/** Types for the work-chart brief (14 Oct 2026). The seed is src/data/mock-companies.json. */

export type SeatType = 'human' | 'bot' | 'system'
export type TriggerSource = 'email' | 'chat' | 'meeting' | 'dashboard' | 'customer' | 'alert' | 'management' | 'schedule'
export type WorkstreamKind = 'main' | 'contingency'
export type StepLevel = 2 | 3 | 4
export type ActivityAction =
  | 'started'
  | 'completed'
  | 'handed_off'
  | 'flagged'
  | 'approved'
  | 'rejected'
  | 'spawned_contingency'
export type Status = 'pending' | 'in_progress' | 'awaiting_approval' | 'approved' | 'rejected' | 'done' | 'exception'

/** As-of date for the 30-day stats window. The demo seed is frozen against this day. */
export const MOCK_AS_OF = '2026-10-14'

export type SeatStatusFlag = 'active' | 'retired'
export type StepStaffing = 'staffed' | 'unstaffed'
export type LogEventType = 'work' | 'approval' | 'exception' | 'hire' | 'fire'

/** Authority card. Bots need every list non-empty before a hire. */
export interface SeatCard {
  owns: string[]
  may: string[]
  mustAskBefore: string[]
  doneWhen: string[]
}

export interface SeatProfile {
  department: string
  location: string
  email: string
  phone: string
  startedOn: string
  bio: string
}

export interface OrgGoals {
  title: string
  dueOn: string
  milestones: { title: string; done: boolean }[]
}

export interface SeatStats {
  usageCount30d: number
  tasksDone30d: number
  /** ISO 8601 with a numeric offset. */
  lastActiveAt: string
}

export interface Org {
  id: string
  name: string
  description?: string
  industry: string
  /** Sample companies are fictional. The owner org is Miguel's real team. */
  mock: boolean
  /** Miguel's organization. Not a sample company. */
  ownerOrg?: boolean
  tagline?: string
  address?: string
  revenueBand?: string
  headcount?: string
  founded?: number
  /** Two-letter mark on the org card. */
  mark?: string
  markColor?: string
  goals?: OrgGoals
  /**
   * Set on the owner org. States why hire and fire are absent from the real log.
   * Sample companies do not use this.
   */
  logExemption?: string
  seatIds: string[]
  workstreamIds: string[]
}

export interface DemoActivity {
  label: 'Demo activity (sample)'
  events: LogEvent[]
}

export interface Seat {
  id: string
  orgId: string
  name: string
  role: string
  /** Chart blurb when set. Otherwise the first Owns line is used. */
  description?: string
  type: SeatType
  /** Org-chart edge. Omitted on the top human. */
  reportsTo?: string
  /** Bot only. Editable in the session; a reload restores this seed value. */
  prompt?: string
  /** Bot only. Empty until a real Grok Bot link exists. */
  grokShareUrl?: string | null
  addToGrokBotUrl?: string | null
  /** Any http(s) link for a bot the user already has. Opens with Open in Grok Bot. */
  grokBotUrl?: string | null
  integrations?: string[]
  curated: true
  card: SeatCard
  /** Where each card field came from. The handbook tag is not part of the displayed sentence. */
  provenance?: { owns: string; may: string; mustAskBefore: string; doneWhen: string }
  profile?: SeatProfile
  /** Humans stay active. Only bots may be retired. */
  status?: SeatStatusFlag
  /** Present on bots once the performance fields are in the seed. */
  stats?: SeatStats
  /** ISO date from a bots-file import. */
  createdAt?: string
  /** Imported last run. The performance table may show a later live-log time instead. */
  importedLastActive?: string
  runs30d?: number
  importedTasks30d?: number
  routines?: { name: string; schedule: string; lastRun?: string; description?: string }[]
  /** Bot only. Where the seat came from: the directory, an import from Grok Bot, or Add a seat. */
  origin?: 'directory' | 'imported' | 'manual'
  /** Bot only. The directory entry a hired bot came from. */
  directoryId?: string
  /** Bot only. Reusable workflows, shown in Profile. */
  skills?: { name: string; description?: string }[]
  /** Bot only. The prompt Grok Bot gets, written in Profile. */
  instructions?: string
  /** Bot only. The public share link from Grok Bot, when the bot is public. */
  publicUrl?: string
  /** Live performance for this bot. Absent on sample charts that still use stats. */
  shown?: { createdAt: string; lastActive: string; usage: number | null; tasks: number | null }
  /** Set by Sync with Grok Bot. */
  grokSync?: 'new' | 'synced' | 'missing'
  grokSyncedAt?: string
  grokMissingSince?: string
  hiredAt?: string
  retiredAt?: string | null
}

export interface Trigger {
  id: string
  orgId: string
  source: TriggerSource
  label: string
  example: string
}

export interface Workstream {
  id: string
  orgId: string
  triggerId: string
  outcome: string
  /** Accountable human. */
  ownerSeatId: string
  parentWorkstreamId?: string
  kind: WorkstreamKind
  stepIds: string[]
}

export interface Step {
  id: string
  workstreamId: string
  name: string
  level: StepLevel
  executorSeatId: string
  /** Set when a step has no current executor. Omitted while the step is staffed. */
  staffing?: StepStaffing
  inputs: string[]
  outputs: string[]
  /** Step id or workstream id where exceptions go. */
  exceptionTo?: string
  checkpointId?: string
}

export interface Handoff {
  id: string
  fromStepId: string
  toStepId: string
  condition?: string
}

export interface Checkpoint {
  id: string
  stepId: string
  rule: string
  /** Must be a human seat. */
  approverSeatId: string
  required: boolean
}

export interface ActivityEvent {
  id: string
  at: string
  workstreamId: string
  stepId: string
  actorSeatId: string
  actorType: SeatType
  action: ActivityAction
  status: Status
  inputRefs: string[]
  outputRefs: string[]
  approverSeatId?: string
  note?: string
}

/** History log from the demo-scope contract. Kept beside the brief's ActivityEvent. */
export interface LogEvent {
  id: string
  orgId: string
  type: LogEventType
  actorSeatId: string
  actorType: SeatType
  timestamp: string
  summary: string
  subjectSeatId?: string
  stepId?: string
  workstreamId?: string
  status?: string
  approverSeatId?: string
}

export interface CompanySeed {
  org: Org
  seats: Seat[]
  triggers: Trigger[]
  workstreams: Workstream[]
  steps: Step[]
  handoffs: Handoff[]
  checkpoints: Checkpoint[]
  activity: ActivityEvent[]
  /** History log from the demo-scope contract, beside the brief's activity events. */
  log?: LogEvent[]
  /** Sample walkthrough events. Never merged into log. */
  demoActivity?: DemoActivity
}

export interface MockSeed {
  asOf?: string
  /** Undecided product choices, when the seed records them. */
  todos?: string[]
  companies: CompanySeed[]
}

export type SampleChart = 'work' | 'org' | 'activity' | 'performance' | 'history' | 'directory' | 'log'
