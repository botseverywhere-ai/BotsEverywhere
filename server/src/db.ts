import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import * as schema from './schema.js'
import { newId } from './crypto.js'
import type { CatalogBot } from './frontmatter.js'

export type DB = BetterSQLite3Database<typeof schema>

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  slack_user_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS otp_email_created ON otp_codes (email, created_at);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slack_team_id TEXT UNIQUE,
  slack_team_name TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  edit_token_hash TEXT,
  view_token_hash TEXT,
  organization_id TEXT,
  link_seal TEXT
);
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER
);
CREATE TABLE IF NOT EXISTS seats (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  bot_slug TEXT,
  human_owner TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bot',
  reports_to TEXT,
  owns TEXT NOT NULL DEFAULT '',
  may TEXT NOT NULL DEFAULT '',
  must_ask_before TEXT NOT NULL DEFAULT '',
  done_when TEXT NOT NULL DEFAULT '',
  card_provenance TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS seats_team ON seats (team_id, sort_order);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_on TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_org ON goals (organization_id, sort_order);
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL,
  due_on TEXT,
  sort_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS milestones_goal ON milestones (goal_id, sort_order);
CREATE TABLE IF NOT EXISTS workstreams (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  owner_seat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  trigger_label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workstreams_team ON workstreams (team_id);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  executor_seat_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS steps_workstream ON steps (workstream_id, sort_order);
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  workstream_id TEXT NOT NULL,
  from_step_id TEXT NOT NULL,
  to_step_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  approver_seat_id TEXT NOT NULL,
  required INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  at TEXT NOT NULL,
  summary TEXT NOT NULL,
  commit_sha TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_org ON activity_log (organization_id, at);
CREATE TABLE IF NOT EXISTS rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_lookup ON rate_events (bucket, ip, created_at);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`

export const SAMPLE_TEAM_ID = 'sample'

const DEFAULT_SEATS: { name: string; role: string; botSlug: string | null; humanOwner: string }[] = [
  { name: 'Research', role: 'Sense and synthesize', botSlug: 'research', humanOwner: 'You' },
  { name: 'Social Post Bot', role: 'Short posts, human approve', botSlug: 'writing', humanOwner: 'You' },
  { name: 'Site', role: 'Drafts to publish', botSlug: 'site', humanOwner: 'You' },
  { name: 'Ops', role: 'Inbox and follow-ups', botSlug: null, humanOwner: 'You' },
]

export function openDatabase(sqlite: Database.Database): DB {
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(SCHEMA_SQL)
  ensureColumn(sqlite, 'teams', 'edit_token_hash', 'ALTER TABLE teams ADD COLUMN edit_token_hash TEXT')
  ensureColumn(sqlite, 'teams', 'view_token_hash', 'ALTER TABLE teams ADD COLUMN view_token_hash TEXT')
  ensureColumn(sqlite, 'teams', 'organization_id', 'ALTER TABLE teams ADD COLUMN organization_id TEXT')
  ensureColumn(sqlite, 'teams', 'link_seal', 'ALTER TABLE teams ADD COLUMN link_seal TEXT')
  ensureColumn(sqlite, 'seats', 'kind', "ALTER TABLE seats ADD COLUMN kind TEXT NOT NULL DEFAULT 'bot'")
  ensureColumn(sqlite, 'seats', 'reports_to', 'ALTER TABLE seats ADD COLUMN reports_to TEXT')
  ensureColumn(sqlite, 'seats', 'owns', "ALTER TABLE seats ADD COLUMN owns TEXT NOT NULL DEFAULT ''")
  ensureColumn(sqlite, 'seats', 'may', "ALTER TABLE seats ADD COLUMN may TEXT NOT NULL DEFAULT ''")
  ensureColumn(sqlite, 'seats', 'must_ask_before', "ALTER TABLE seats ADD COLUMN must_ask_before TEXT NOT NULL DEFAULT ''")
  ensureColumn(sqlite, 'seats', 'done_when', "ALTER TABLE seats ADD COLUMN done_when TEXT NOT NULL DEFAULT ''")
  ensureColumn(sqlite, 'seats', 'card_provenance', "ALTER TABLE seats ADD COLUMN card_provenance TEXT NOT NULL DEFAULT ''")
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS teams_edit_token_hash ON teams (edit_token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS teams_view_token_hash ON teams (view_token_hash);
    CREATE INDEX IF NOT EXISTS teams_organization ON teams (organization_id);
  `)
  return drizzle(sqlite, { schema })
}

function ensureColumn(sqlite: Database.Database, table: string, column: string, ddl: string) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!rows.some((row) => row.name === column)) sqlite.exec(ddl)
}

export function seedSampleTeam(db: DB, catalog: CatalogBot[], now = Date.now()): void {
  const existing = db.select().from(schema.teams).where(eq(schema.teams.id, SAMPLE_TEAM_ID)).get()
  if (existing) return
  db.insert(schema.teams)
    .values({
      id: SAMPLE_TEAM_ID,
      name: 'Sample team',
      slackTeamId: null,
      slackTeamName: null,
      isSample: 1,
      createdAt: now,
    })
    .run()
  insertDefaultSeats(db, SAMPLE_TEAM_ID, catalog)
}

export function insertDefaultSeats(db: DB, teamId: string, catalog: CatalogBot[]): void {
  const slugs = new Set(catalog.map((bot) => bot.slug))
  DEFAULT_SEATS.forEach((seat, index) => {
    db.insert(schema.seats)
      .values({
        id: newId(),
        teamId,
        name: seat.name,
        role: seat.role,
        botSlug: seat.botSlug && slugs.has(seat.botSlug) ? seat.botSlug : null,
        humanOwner: seat.humanOwner,
        sortOrder: index,
      })
      .run()
  })
}
