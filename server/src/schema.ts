import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  slackUserId: text('slack_user_id'),
  createdAt: integer('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull(),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

export const otpCodes = sqliteTable('otp_codes', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: integer('expires_at').notNull(),
  attempts: integer('attempts').notNull(),
  ip: text('ip').notNull(),
  createdAt: integer('created_at').notNull(),
  consumedAt: integer('consumed_at'),
})

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slackTeamId: text('slack_team_id').unique(),
  slackTeamName: text('slack_team_name'),
  isSample: integer('is_sample').notNull(),
  createdAt: integer('created_at').notNull(),
  editTokenHash: text('edit_token_hash'),
  viewTokenHash: text('view_token_hash'),
  organizationId: text('organization_id'),
  /** Team link pair, sealed with the current owner token. Null when the team has no organization. */
  linkSeal: text('link_seal'),
})

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerTokenHash: text('owner_token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
})

export const memberships = sqliteTable(
  'memberships',
  {
    teamId: text('team_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
)

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  email: text('email'),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: text('created_by').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  acceptedAt: integer('accepted_at'),
})

export const seats = sqliteTable('seats', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  botSlug: text('bot_slug'),
  humanOwner: text('human_owner').notNull(),
  sortOrder: integer('sort_order').notNull(),
  /** human, bot, or system. */
  kind: text('kind').notNull().default('bot'),
  reportsTo: text('reports_to'),
  owns: text('owns').notNull().default(''),
  may: text('may').notNull().default(''),
  mustAskBefore: text('must_ask_before').notNull().default(''),
  doneWhen: text('done_when').notNull().default(''),
  /** JSON: which source each card field came from. Not shown as a handbook tag. */
  cardProvenance: text('card_provenance').notNull().default(''),
})

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  title: text('title').notNull(),
  dueOn: text('due_on').notNull(),
  sortOrder: integer('sort_order').notNull(),
})

export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull(),
  title: text('title').notNull(),
  done: integer('done').notNull(),
  dueOn: text('due_on'),
  sortOrder: integer('sort_order').notNull(),
})

export const workstreams = sqliteTable('workstreams', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  outcome: text('outcome').notNull(),
  ownerSeatId: text('owner_seat_id').notNull(),
  kind: text('kind').notNull(),
  triggerSource: text('trigger_source').notNull(),
  triggerLabel: text('trigger_label').notNull(),
})

export const steps = sqliteTable('steps', {
  id: text('id').primaryKey(),
  workstreamId: text('workstream_id').notNull(),
  name: text('name').notNull(),
  level: integer('level').notNull(),
  executorSeatId: text('executor_seat_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
})

export const handoffs = sqliteTable('handoffs', {
  id: text('id').primaryKey(),
  workstreamId: text('workstream_id').notNull(),
  fromStepId: text('from_step_id').notNull(),
  toStepId: text('to_step_id').notNull(),
})

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  stepId: text('step_id').notNull(),
  rule: text('rule').notNull(),
  approverSeatId: text('approver_seat_id').notNull(),
  required: integer('required').notNull(),
})

export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  at: text('at').notNull(),
  summary: text('summary').notNull(),
  commitSha: text('commit_sha').notNull(),
})

export const rateEvents = sqliteTable('rate_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bucket: text('bucket').notNull(),
  ip: text('ip').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const oauthStates = sqliteTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  nonce: text('nonce').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: integer('expires_at').notNull(),
})
