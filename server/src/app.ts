import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import * as schema from './schema.js'
import { insertDefaultSeats, openDatabase, SAMPLE_TEAM_ID, seedSampleTeam, type DB } from './db.js'
import { clip, hashOtp, newId, normalizeEmail, openSecret, randomCode, randomToken, safeEqual, sealSecret, sha256 } from './crypto.js'
import {
  canEditSeats,
  canManageTeam,
  canReadTeam,
  canRegenerateLinks,
  canRenameTeam,
  isRole,
  type Role,
  type ShareLevel,
} from './permissions.js'
import { inviteMessage, signInMessage, type Mailer } from './mail.js'
import { exchangeSlackCode, fetchSlackProfile, slackAuthorizeUrl } from './slack.js'
import type { CatalogBot } from './frontmatter.js'
import type Database from 'better-sqlite3'

export const SESSION_COOKIE = 'be_session'
export const CSRF_COOKIE = 'be_csrf'
export const SLACK_COOKIE = 'be_slack_state'

export const OTP_TTL_MS = 10 * 60 * 1000
export const EMAIL_WINDOW_MS = 10 * 60 * 1000
export const EMAIL_SEND_LIMIT = 3
export const IP_SEND_LIMIT = 30
export const MAX_ATTEMPTS = 5
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const CREATE_WINDOW_MS = 10 * 60 * 1000
export const WRITE_WINDOW_MS = 60 * 1000
export const DEFAULT_CREATE_LIMIT = 8
export const DEFAULT_WRITE_LIMIT = 60

export function readAuthEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.AUTH_ENABLED === 'true'
}

export interface AppEnv {
  appOrigin: string
  cookieSecure: boolean
  otpPepper: string
  slackClientId?: string
  slackClientSecret?: string
  trustProxy: boolean
  authEnabled: boolean
  createLimit: number
  writeLimit: number
}

export interface CreateAppInput {
  sqlite: Database.Database
  mailer: Mailer
  catalog: CatalogBot[]
  env: AppEnv
  now?: () => number
  fetchImpl?: typeof fetch
}

interface SessionRow {
  tokenHash: string
  userId: string
  csrfToken: string
  expiresAt: number
}

interface UserRow {
  id: string
  email: string
  name: string | null
  slackUserId: string | null
  createdAt: number
}

export function createApp(input: CreateAppInput) {
  const db = openDatabase(input.sqlite)
  seedSampleTeam(db, input.catalog, input.now?.())
  const now = input.now ?? Date.now
  const fetchImpl = input.fetchImpl ?? fetch
  const catalogSlugs = new Set(input.catalog.map((bot) => bot.slug))
  const app = new Hono()

  app.use('/api/*', async (c, next) => {
    const method = c.req.method
    if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
      const creatingTeam = method === 'POST' && c.req.path === '/api/teams'
      const creatingOrg = method === 'POST' && c.req.path === '/api/organizations'
      const creating = creatingTeam || creatingOrg
      const limited = hitRateLimit(db, {
        bucket: creatingOrg ? 'org-create' : creatingTeam ? 'team-create' : 'api-write',
        ip: clientIp(c, input.env.trustProxy),
        limit: creating ? input.env.createLimit : input.env.writeLimit,
        windowMs: creating ? CREATE_WINDOW_MS : WRITE_WINDOW_MS,
        stamp: now(),
      })
      if (limited) return c.json({ error: 'Too many requests. Wait a few minutes and try again.' }, 429)
    }
    await next()
    c.header('Cache-Control', 'no-store')
    if (
      c.req.path.startsWith('/api/share') ||
      c.req.path.startsWith('/api/owner') ||
      c.req.path.startsWith('/api/organizations') ||
      (c.req.path.startsWith('/api/teams') && !isSampleApi(c.req.path))
    ) {
      c.header('X-Robots-Tag', 'noindex, nofollow')
    }
  })

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/session', (c) => {
    const session = readSession(c, db, now, input.env.authEnabled)
    const user = session ? readUser(db, session.userId) : null
    const csrfToken = session?.csrfToken ?? ensureAnonCsrf(c, input.env)
    writeCsrf(c, csrfToken, input.env, session ? SESSION_TTL_MS : 24 * 60 * 60 * 1000)
    return c.json({
      user: user ? publicUser(user) : null,
      teams: user ? listTeams(db, user.id) : [],
      csrfToken,
      authEnabled: input.env.authEnabled,
    })
  })

  app.post('/api/auth/email/start', async (c) => {
    const off = authDisabled(c, input.env)
    if (off) return off
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const email = normalizeEmail(isRecord(body) ? body.email : null)
    if (!email) return c.json({ error: 'Enter a valid email address.' }, 400)
    const ip = clientIp(c, input.env.trustProxy)
    const since = now() - EMAIL_WINDOW_MS
    const byEmail = db
      .select()
      .from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.email, email), gte(schema.otpCodes.createdAt, since)))
      .all()
    if (byEmail.length >= EMAIL_SEND_LIMIT) {
      return c.json({ error: 'Too many codes for that email. Wait a few minutes and try again.' }, 429)
    }
    const byIp = db
      .select()
      .from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.ip, ip), gte(schema.otpCodes.createdAt, since)))
      .all()
    if (byIp.length >= IP_SEND_LIMIT) {
      return c.json({ error: 'Too many codes from this network. Wait a few minutes and try again.' }, 429)
    }
    const code = randomCode()
    db.insert(schema.otpCodes)
      .values({
        id: newId(),
        email,
        codeHash: hashOtp(input.env.otpPepper, email, code),
        expiresAt: now() + OTP_TTL_MS,
        attempts: 0,
        ip,
        createdAt: now(),
        consumedAt: null,
      })
      .run()
    const message = signInMessage(code)
    await input.mailer.send({ to: email, subject: message.subject, text: message.text, code })
    return c.json({ ok: true })
  })

  app.post('/api/auth/email/verify', async (c) => {
    const off = authDisabled(c, input.env)
    if (off) return off
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const email = normalizeEmail(isRecord(body) ? body.email : null)
    const code = isRecord(body) && typeof body.code === 'string' ? body.code.trim() : ''
    if (!email || !/^\d{6}$/.test(code)) return c.json({ error: 'Enter the 6-digit code.' }, 400)
    const row = db
      .select()
      .from(schema.otpCodes)
      .where(and(eq(schema.otpCodes.email, email), isNull(schema.otpCodes.consumedAt)))
      .all()
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (!row) return c.json({ error: 'That code is not valid.' }, 401)
    if (row.expiresAt < now()) return c.json({ error: 'That code expired. Request a new one.' }, 401)
    if (row.attempts >= MAX_ATTEMPTS) return c.json({ error: 'Too many attempts. Request a new code.' }, 401)
    if (!safeEqual(row.codeHash, hashOtp(input.env.otpPepper, email, code))) {
      db.update(schema.otpCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(schema.otpCodes.id, row.id))
        .run()
      return c.json({ error: 'That code is not valid.' }, 401)
    }
    db.update(schema.otpCodes).set({ consumedAt: now() }).where(eq(schema.otpCodes.id, row.id)).run()
    const user = upsertUser(db, { email, name: null, slackUserId: null, now: now() })
    applyEmailInvites(db, user, now())
    const session = issueSession(c, db, user.id, input.env, now())
    return c.json({
      user: publicUser(user),
      teams: listTeams(db, user.id),
      csrfToken: session.csrfToken,
    })
  })

  app.post('/api/auth/logout', (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const session = readSession(c, db, now, input.env.authEnabled)
    if (session) db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, session.tokenHash)).run()
    clearCookie(c, SESSION_COOKIE, input.env)
    clearCookie(c, CSRF_COOKIE, input.env)
    return c.json({ ok: true })
  })

  app.get('/api/auth/slack/start', (c) => {
    const off = authDisabled(c, input.env)
    if (off) return off
    if (!input.env.slackClientId || !input.env.slackClientSecret) {
      return c.json({ error: 'Slack sign-in is not configured.' }, 503)
    }
    const state = randomToken()
    const nonce = randomToken()
    const returnTo = safeReturn(c.req.query('return'))
    db.insert(schema.oauthStates)
      .values({
        stateHash: sha256(state),
        nonce,
        returnTo,
        expiresAt: now() + 10 * 60 * 1000,
      })
      .run()
    writeCookie(c, SLACK_COOKIE, state, input.env, 10 * 60)
    const redirectUri = slackRedirect(input.env.appOrigin)
    return c.redirect(
      slackAuthorizeUrl({
        clientId: input.env.slackClientId,
        redirectUri,
        state,
        nonce,
      }),
    )
  })

  app.get('/api/auth/slack/callback', async (c) => {
    const off = authDisabled(c, input.env)
    if (off) return off
    const fail = (reason: string) => c.redirect(`${input.env.appOrigin}/#signin?error=${reason}`)
    if (!input.env.slackClientId || !input.env.slackClientSecret) return fail('slack')
    const state = c.req.query('state') ?? ''
    const code = c.req.query('code') ?? ''
    const cookieState = getCookie(c, SLACK_COOKIE) ?? ''
    clearCookie(c, SLACK_COOKIE, input.env)
    if (!state || !code || !cookieState || !safeEqual(state, cookieState)) return fail('slack')
    const saved = db.select().from(schema.oauthStates).where(eq(schema.oauthStates.stateHash, sha256(state))).get()
    db.delete(schema.oauthStates).where(eq(schema.oauthStates.stateHash, sha256(state))).run()
    if (!saved || saved.expiresAt < now()) return fail('slack')
    try {
      const access = await exchangeSlackCode({
        fetchImpl,
        clientId: input.env.slackClientId,
        clientSecret: input.env.slackClientSecret,
        code,
        redirectUri: slackRedirect(input.env.appOrigin),
      })
      const profile = await fetchSlackProfile(fetchImpl, access)
      const email = normalizeEmail(profile.email)
      if (!email) return fail('slack')
      const user = upsertUser(db, {
        email,
        name: profile.name,
        slackUserId: profile.slackUserId,
        now: now(),
      })
      joinSlackWorkspace(db, user, profile, input.catalog, now())
      applyEmailInvites(db, user, now())
      issueSession(c, db, user.id, input.env, now())
      return c.redirect(`${input.env.appOrigin}/#${saved.returnTo || 'teams'}`)
    } catch (error) {
      console.error('Slack sign-in failed', error instanceof Error ? error.message : 'error')
      return fail('slack')
    }
  })

  app.get('/api/teams', (c) => {
    const user = requireUser(c, db, now, input.env.authEnabled)
    if (!user) return c.json({ error: 'Sign in required.' }, 401)
    return c.json({ teams: listTeams(db, user.id) })
  })

  app.post('/api/teams', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const user = requireUser(c, db, now, input.env.authEnabled)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const name = clip(isRecord(body) ? body.name : null, 80)
    if (!name) return c.json({ error: 'Team name is required.' }, 400)
    const id = newId()
    const stamp = now()
    const links = issueLinks(input.env.appOrigin)
    const ownerToken = c.req.header('x-owner-token')
    const organization = findOrganization(db, ownerToken)
    if (ownerToken && !organization) return c.json({ error: 'Organization not found.' }, 404)
    db.insert(schema.teams)
      .values({
        id,
        name,
        slackTeamId: null,
        slackTeamName: null,
        isSample: 0,
        createdAt: stamp,
        editTokenHash: links.editTokenHash,
        viewTokenHash: links.viewTokenHash,
        organizationId: organization?.id ?? null,
        linkSeal: organization && ownerToken ? sealPair(ownerToken, links.editToken, links.viewToken) : null,
      })
      .run()
    if (user) {
      db.insert(schema.memberships)
        .values({ teamId: id, userId: user.id, role: 'owner', createdAt: stamp })
        .run()
    }
    insertDefaultSeats(db, id, input.catalog)
    return c.json(
      {
        team: { id, name, role: user ? ('owner' as Role) : null },
        links: { editUrl: links.editUrl, viewUrl: links.viewUrl },
      },
      201,
    )
  })

  app.get('/api/share/session', (c) => {
    const found = findByShareToken(db, c.req.header('x-share-token'))
    if (!found) return c.json({ error: 'Team not found.' }, 404)
    return c.json({
      team: {
        id: found.team.id,
        name: found.team.name,
        role: found.access === 'edit' ? 'editor' : 'viewer',
        access: found.access,
        sample: false,
      },
    })
  })

  app.get('/api/teams/:id', (c) => {
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    const displayRole = access.role ?? (access.share === 'edit' ? 'editor' : access.share === 'view' ? 'viewer' : null)
    return c.json({
      team: {
        id: access.team.id,
        name: access.team.name,
        role: displayRole,
        access: access.share,
        sample: access.team.isSample === 1,
        slackTeamId: access.team.slackTeamId,
      },
    })
  })

  app.patch('/api/teams/:id', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    if (access.team.isSample === 1) return c.json({ error: 'The sample team is read-only.' }, 403)
    if (!canRenameTeam({ isSample: false, role: access.role, share: access.share })) {
      const message = access.share === 'view' ? 'This view link is read-only.' : 'Only an owner can rename the team.'
      return c.json({ error: message }, 403)
    }
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const name = clip(isRecord(body) ? body.name : null, 80)
    if (!name) return c.json({ error: 'Team name is required.' }, 400)
    db.update(schema.teams).set({ name }).where(eq(schema.teams.id, access.team.id)).run()
    return c.json({ team: { id: access.team.id, name, role: access.role } })
  })

  app.post('/api/teams/:id/links', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    if (access.team.isSample === 1) return c.json({ error: 'The sample team is read-only.' }, 403)
    if (!canRegenerateLinks({ isSample: false, share: access.share })) {
      return c.json({ error: 'Only the edit link can regenerate links.' }, 403)
    }
    const links = issueLinks(input.env.appOrigin)
    const ownerToken = c.req.header('x-owner-token')
    const organization = findOrganization(db, ownerToken)
    const inOrg = Boolean(access.team.organizationId)
    const canSeal = Boolean(inOrg && organization && ownerToken && organization.id === access.team.organizationId)
    db.update(schema.teams)
      .set({
        editTokenHash: links.editTokenHash,
        viewTokenHash: links.viewTokenHash,
        linkSeal: canSeal && ownerToken ? sealPair(ownerToken, links.editToken, links.viewToken) : null,
      })
      .where(eq(schema.teams.id, access.team.id))
      .run()
    return c.json({ links: { editUrl: links.editUrl, viewUrl: links.viewUrl } })
  })

  app.post('/api/organizations', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const name = clip(isRecord(body) ? body.name : null, 80)
    if (!name) return c.json({ error: 'Organization name is required.' }, 400)
    const ownerToken = randomToken(32)
    const id = newId()
    db.insert(schema.organizations)
      .values({
        id,
        name,
        ownerTokenHash: sha256(ownerToken),
        createdAt: now(),
      })
      .run()
    return c.json(
      {
        organization: { id, name },
        ownerUrl: ownerUrl(input.env.appOrigin, ownerToken),
      },
      201,
    )
  })

  app.get('/api/owner/session', (c) => {
    const owned = requireOwner(c, db)
    if (!owned) return c.json({ error: 'Organization not found.' }, 404)
    const teams = db.select().from(schema.teams).where(eq(schema.teams.organizationId, owned.organization.id)).all()
    return c.json({
      organization: { id: owned.organization.id, name: owned.organization.name },
      teams: listOwnedTeams(db, owned.organization.id, owned.token, input.env.appOrigin),
      goals: listGoals(db, owned.organization.id),
      activity: listActivity(db, owned.organization.id),
      charts: teams.map((team) => ({ teamId: team.id, teamName: team.name, ...teamChart(db, team.id) })),
    })
  })

  app.post('/api/owner/goals', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const owned = requireOwner(c, db)
    if (!owned) return c.json({ error: 'Organization not found.' }, 404)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const title = clip(isRecord(body) ? body.title : null, 160)
    const dueOn = readDay(isRecord(body) ? body.dueOn : null, true)
    if (!title) return c.json({ error: 'Goal title is required.' }, 400)
    if (dueOn === 'bad' || !dueOn) return c.json({ error: 'Due date must be YYYY-MM-DD.' }, 400)
    const order = listGoals(db, owned.organization.id).reduce((max, goal) => Math.max(max, goal.sortOrder), -1) + 1
    const id = newId()
    db.insert(schema.goals).values({ id, organizationId: owned.organization.id, title, dueOn, sortOrder: order }).run()
    return c.json({ goal: { id, title, dueOn, milestones: [], progress: { done: 0, total: 0 }, sortOrder: order } }, 201)
  })

  app.patch('/api/owner/goals/:goalId', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const owned = requireOwner(c, db)
    if (!owned) return c.json({ error: 'Organization not found.' }, 404)
    const current = goalInOrg(db, c.req.param('goalId'), owned.organization.id)
    if (!current) return c.json({ error: 'Goal not found.' }, 404)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const record = isRecord(body) ? body : null
    const title = record && 'title' in record ? clip(record.title, 160) : current.title
    const dueOn = record && 'dueOn' in record ? readDay(record.dueOn, true) : current.dueOn
    if (!title) return c.json({ error: 'Goal title is required.' }, 400)
    if (dueOn === 'bad' || !dueOn) return c.json({ error: 'Due date must be YYYY-MM-DD.' }, 400)
    db.update(schema.goals).set({ title, dueOn }).where(eq(schema.goals.id, current.id)).run()
    return c.json({ goals: listGoals(db, owned.organization.id) })
  })

  app.delete('/api/owner/goals/:goalId', (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const owned = requireOwner(c, db)
    if (!owned) return c.json({ error: 'Organization not found.' }, 404)
    const current = goalInOrg(db, c.req.param('goalId'), owned.organization.id)
    if (!current) return c.json({ error: 'Goal not found.' }, 404)
    db.delete(schema.milestones).where(eq(schema.milestones.goalId, current.id)).run()
    db.delete(schema.goals).where(eq(schema.goals.id, current.id)).run()
    return c.json({ ok: true })
  })

  app.post('/api/owner/goals/:goalId/milestones', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const owned = requireOwner(c, db)
    if (!owned) return c.json({ error: 'Organization not found.' }, 404)
    const goal = goalInOrg(db, c.req.param('goalId'), owned.organization.id)
    if (!goal) return c.json({ error: 'Goal not found.' }, 404)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const record = isRecord(body) ? body : null
    const title = clip(record?.title, 160)
    const dueOn = readDay(record?.dueOn, false)
    if (!title) return c.json({ error: 'Milestone title is required.' }, 400)
    if (dueOn === 'bad') return c.json({ error: 'Milestone date must be YYYY-MM-DD.' }, 400)
    const order = db
      .select()
      .from(schema.milestones)
      .where(eq(schema.milestones.goalId, goal.id))
      .all()
      .reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1
    db.insert(schema.milestones)
      .values({ id: newId(), goalId: goal.id, title, done: 0, dueOn, sortOrder: order })
      .run()
    return c.json({ goals: listGoals(db, owned.organization.id) }, 201)
  })

  app.patch('/api/owner/milestones/:milestoneId', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const owned = requireOwner(c, db)
    if (!owned) return c.json({ error: 'Organization not found.' }, 404)
    const current = milestoneInOrg(db, c.req.param('milestoneId'), owned.organization.id)
    if (!current) return c.json({ error: 'Milestone not found.' }, 404)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const record = isRecord(body) ? body : {}
    const title = 'title' in record ? clip(record.title, 160) : current.title
    if (!title) return c.json({ error: 'Milestone title is required.' }, 400)
    let dueOn = current.dueOn
    if ('dueOn' in record) {
      const parsed = readDay(record.dueOn, false)
      if (parsed === 'bad') return c.json({ error: 'Milestone date must be YYYY-MM-DD.' }, 400)
      dueOn = parsed
    }
    const done = 'done' in record ? (record.done === true ? 1 : record.done === false ? 0 : null) : current.done
    if (done === null) return c.json({ error: 'Done must be true or false.' }, 400)
    db.update(schema.milestones).set({ title, dueOn, done }).where(eq(schema.milestones.id, current.id)).run()
    return c.json({ goals: listGoals(db, owned.organization.id) })
  })

  app.delete('/api/owner/milestones/:milestoneId', (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const owned = requireOwner(c, db)
    if (!owned) return c.json({ error: 'Organization not found.' }, 404)
    const current = milestoneInOrg(db, c.req.param('milestoneId'), owned.organization.id)
    if (!current) return c.json({ error: 'Milestone not found.' }, 404)
    db.delete(schema.milestones).where(eq(schema.milestones.id, current.id)).run()
    return c.json({ goals: listGoals(db, owned.organization.id) })
  })

  app.post('/api/owner/regenerate', (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const token = c.req.header('x-owner-token')
    const organization = findOrganization(db, token)
    if (!organization || !token) return c.json({ error: 'Organization not found.' }, 404)
    const next = randomToken(32)
    const owned = db.select().from(schema.teams).where(eq(schema.teams.organizationId, organization.id)).all()
    for (const team of owned) {
      const pair = openPair(token, team.linkSeal)
      db.update(schema.teams)
        .set({ linkSeal: pair ? sealPair(next, pair.editToken, pair.viewToken) : null })
        .where(eq(schema.teams.id, team.id))
        .run()
    }
    db.update(schema.organizations)
      .set({ ownerTokenHash: sha256(next) })
      .where(eq(schema.organizations.id, organization.id))
      .run()
    return c.json({ ownerUrl: ownerUrl(input.env.appOrigin, next) })
  })

  app.post('/api/owner/claim', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const token = c.req.header('x-owner-token')
    const organization = findOrganization(db, token)
    if (!organization || !token) return c.json({ error: 'Organization not found.' }, 404)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const pasted = clip(isRecord(body) ? body.editLink : null, 2000)
    if (!pasted) return c.json({ error: 'Paste the team edit link.' }, 400)
    const parsed = parseTeamLink(pasted)
    if (parsed.kind === 'view') return c.json({ error: 'A view link cannot claim a team.' }, 403)
    if (parsed.kind !== 'edit') return c.json({ error: 'Paste the team edit link.' }, 400)
    const found = findByShareToken(db, parsed.token)
    if (!found || found.access !== 'edit') return c.json({ error: 'That edit link does not match a team.' }, 404)
    if (found.team.isSample === 1) return c.json({ error: 'The sample team cannot be claimed.' }, 403)
    if (found.team.organizationId && found.team.organizationId !== organization.id) {
      return c.json({ error: 'That team already belongs to another organization.' }, 409)
    }
    if (found.team.organizationId === organization.id) {
      const urls = urlsFor(input.env.appOrigin, openPair(token, found.team.linkSeal), found.team)
      return c.json({
        team: { id: found.team.id, name: found.team.name },
        links: urls.editUrl && urls.viewUrl ? { editUrl: urls.editUrl, viewUrl: urls.viewUrl } : null,
      })
    }
    const links = issueLinks(input.env.appOrigin)
    db.update(schema.teams)
      .set({
        organizationId: organization.id,
        editTokenHash: links.editTokenHash,
        viewTokenHash: links.viewTokenHash,
        linkSeal: sealPair(token, links.editToken, links.viewToken),
      })
      .where(eq(schema.teams.id, found.team.id))
      .run()
    return c.json({
      team: { id: found.team.id, name: found.team.name },
      links: { editUrl: links.editUrl, viewUrl: links.viewUrl },
      replacedLinks: true,
    })
  })

  app.get('/api/teams/:id/seats', (c) => {
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    return c.json({ seats: listSeats(db, access.team.id) })
  })

  app.get('/api/teams/:id/work', (c) => {
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    return c.json(teamChart(db, access.team.id))
  })

  app.post('/api/teams/:id/seats', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    const write = seatWrite(access)
    if (write) return write
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const seat = readSeat(body, catalogSlugs)
    if (typeof seat === 'string') return c.json({ error: seat }, 400)
    const order = listSeats(db, access.team.id).reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1
    const id = newId()
    db.insert(schema.seats)
      .values({ id, teamId: access.team.id, sortOrder: order, ...seat })
      .run()
    return c.json({ seat: { id, sortOrder: order, ...seat } }, 201)
  })

  app.patch('/api/teams/:id/seats/:seatId', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    const write = seatWrite(access)
    if (write) return write
    const current = db
      .select()
      .from(schema.seats)
      .where(and(eq(schema.seats.id, c.req.param('seatId')), eq(schema.seats.teamId, access.team.id)))
      .get()
    if (!current) return c.json({ error: 'Seat not found.' }, 404)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const seat = readSeat(body, catalogSlugs)
    if (typeof seat === 'string') return c.json({ error: seat }, 400)
    db.update(schema.seats).set(seat).where(eq(schema.seats.id, current.id)).run()
    return c.json({ seat: { id: current.id, sortOrder: current.sortOrder, ...seat } })
  })

  app.delete('/api/teams/:id/seats/:seatId', (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    const write = seatWrite(access)
    if (write) return write
    const current = db
      .select()
      .from(schema.seats)
      .where(and(eq(schema.seats.id, c.req.param('seatId')), eq(schema.seats.teamId, access.team.id)))
      .get()
    if (!current) return c.json({ error: 'Seat not found.' }, 404)
    db.delete(schema.seats).where(eq(schema.seats.id, current.id)).run()
    return c.json({ ok: true })
  })

  app.get('/api/teams/:id/members', (c) => {
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    if (access.team.isSample === 1) return c.json({ members: [] })
    const members = db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.teamId, access.team.id))
      .all()
    const showEmail = access.share === 'edit' || access.role === 'owner' || access.role === 'editor'
    return c.json({
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name,
        role: member.role,
        ...(showEmail ? { email: member.email } : {}),
      })),
    })
  })

  app.patch('/api/teams/:id/members/:userId', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    if (access.team.isSample === 1) return c.json({ error: 'The sample team is read-only.' }, 403)
    if (!canManageTeam({ isSample: false, role: access.role })) {
      return c.json({ error: 'Only an owner can change roles.' }, 403)
    }
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const role = isRecord(body) ? body.role : null
    if (!isRole(role)) return c.json({ error: 'Role must be owner, editor, or viewer.' }, 400)
    const targetId = c.req.param('userId')
    const target = db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.teamId, access.team.id), eq(schema.memberships.userId, targetId)))
      .get()
    if (!target) return c.json({ error: 'Member not found.' }, 404)
    if (target.role === 'owner' && role !== 'owner' && countOwners(db, access.team.id) <= 1) {
      return c.json({ error: 'The team needs at least one owner.' }, 400)
    }
    db.update(schema.memberships)
      .set({ role })
      .where(and(eq(schema.memberships.teamId, access.team.id), eq(schema.memberships.userId, targetId)))
      .run()
    return c.json({ ok: true, role })
  })

  app.delete('/api/teams/:id/members/:userId', (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    if (access.team.isSample === 1) return c.json({ error: 'The sample team is read-only.' }, 403)
    if (!canManageTeam({ isSample: false, role: access.role })) {
      return c.json({ error: 'Only an owner can remove members.' }, 403)
    }
    const targetId = c.req.param('userId')
    const target = db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.teamId, access.team.id), eq(schema.memberships.userId, targetId)))
      .get()
    if (!target) return c.json({ error: 'Member not found.' }, 404)
    if (target.role === 'owner' && countOwners(db, access.team.id) <= 1) {
      return c.json({ error: 'The team needs at least one owner.' }, 400)
    }
    db.delete(schema.memberships)
      .where(and(eq(schema.memberships.teamId, access.team.id), eq(schema.memberships.userId, targetId)))
      .run()
    return c.json({ ok: true })
  })

  app.post('/api/teams/:id/invites', async (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const access = accessFor(c, db, now, c.req.param('id'), input.env.authEnabled)
    if (!access) return c.json({ error: 'Team not found.' }, 404)
    if (access.team.isSample === 1) return c.json({ error: 'The sample team is read-only.' }, 403)
    if (!canManageTeam({ isSample: false, role: access.role })) {
      return c.json({ error: 'Only an owner can invite members.' }, 403)
    }
    const user = requireUser(c, db, now, input.env.authEnabled)
    if (!user) return c.json({ error: 'Sign in required.' }, 401)
    const body = await readBody(c)
    if (body === 'too-big') return c.json({ error: 'Request is too large.' }, 413)
    const role = isRecord(body) ? body.role : null
    if (!isRole(role)) return c.json({ error: 'Role must be owner, editor, or viewer.' }, 400)
    let email: string | null = null
    if (isRecord(body) && body.email != null && body.email !== '') {
      email = normalizeEmail(body.email)
      if (!email) return c.json({ error: 'Enter a valid email address.' }, 400)
    }
    const token = randomToken()
    const stamp = now()
    db.insert(schema.invites)
      .values({
        id: newId(),
        teamId: access.team.id,
        email,
        role,
        tokenHash: sha256(token),
        createdBy: user.id,
        expiresAt: stamp + INVITE_TTL_MS,
        createdAt: stamp,
        acceptedAt: null,
      })
      .run()
    const url = `${input.env.appOrigin}/#invite-${token}`
    if (email) {
      const message = inviteMessage({ teamName: access.team.name, url, role })
      try {
        await input.mailer.send({ to: email, subject: message.subject, text: message.text })
      } catch (error) {
        console.error('Invite email failed', error instanceof Error ? error.message : 'error')
      }
    }
    return c.json({ invite: { url, role, email, expiresAt: stamp + INVITE_TTL_MS } }, 201)
  })

  app.get('/api/invites/:token', (c) => {
    const invite = findInvite(db, c.req.param('token'), now())
    if (!invite) return c.json({ error: 'Invite not found.' }, 404)
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, invite.teamId)).get()
    if (!team || team.isSample === 1) return c.json({ error: 'Invite not found.' }, 404)
    return c.json({
      invite: { teamName: team.name, role: invite.role, email: invite.email, expiresAt: invite.expiresAt },
    })
  })

  app.post('/api/invites/:token/accept', (c) => {
    const denied = requireCsrf(c, db, now, input.env.authEnabled)
    if (denied) return denied
    const user = requireUser(c, db, now, input.env.authEnabled)
    if (!user) return c.json({ error: 'Sign in required.' }, 401)
    const invite = findInvite(db, c.req.param('token'), now())
    if (!invite) return c.json({ error: 'Invite not found.' }, 404)
    if (invite.email && invite.email !== user.email) {
      return c.json({ error: 'This invite was sent to a different email address.' }, 403)
    }
    const existing = db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.teamId, invite.teamId), eq(schema.memberships.userId, user.id)))
      .get()
    if (!existing) {
      db.insert(schema.memberships)
        .values({
          teamId: invite.teamId,
          userId: user.id,
          role: invite.role,
          createdAt: now(),
        })
        .run()
    }
    if (invite.email) {
      db.update(schema.invites).set({ acceptedAt: now() }).where(eq(schema.invites.id, invite.id)).run()
    }
    const team = db.select().from(schema.teams).where(eq(schema.teams.id, invite.teamId)).get()
    return c.json({ team: { id: invite.teamId, name: team?.name ?? 'Team', role: existing?.role ?? invite.role } })
  })

  return app
}

function parseProvenance(raw: string): { owns: string; may: string; mustAskBefore: string; doneWhen: string } | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as { owns?: unknown; may?: unknown; mustAskBefore?: unknown; doneWhen?: unknown }
    if (!parsed || typeof parsed.owns !== 'string') return undefined
    return {
      owns: parsed.owns,
      may: typeof parsed.may === 'string' ? parsed.may : '',
      mustAskBefore: typeof parsed.mustAskBefore === 'string' ? parsed.mustAskBefore : '',
      doneWhen: typeof parsed.doneWhen === 'string' ? parsed.doneWhen : '',
    }
  } catch {
    return undefined
  }
}

function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name }
}

function listTeams(db: DB, userId: string) {
  return db
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      role: schema.memberships.role,
      slackTeamId: schema.teams.slackTeamId,
    })
    .from(schema.memberships)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.memberships.teamId))
    .where(and(eq(schema.memberships.userId, userId), eq(schema.teams.isSample, 0)))
    .all()
}

function listSeats(db: DB, teamId: string) {
  return db
    .select()
    .from(schema.seats)
    .where(eq(schema.seats.teamId, teamId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((seat) => ({
      id: seat.id,
      name: seat.name,
      role: seat.role,
      botSlug: seat.botSlug,
      humanOwner: seat.humanOwner,
      sortOrder: seat.sortOrder,
      kind: seat.kind === 'human' || seat.kind === 'system' ? seat.kind : 'bot',
      reportsTo: seat.reportsTo,
      owns: seat.owns,
      may: seat.may,
      mustAskBefore: seat.mustAskBefore,
      doneWhen: seat.doneWhen,
      provenance: parseProvenance(seat.cardProvenance),
    }))
}

function readSession(c: Context, db: DB, now: () => number, authEnabled: boolean): SessionRow | null {
  if (!authEnabled) return null
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const row = db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).get()
  if (!row || row.expiresAt < now()) return null
  return row
}

function readUser(db: DB, userId: string): UserRow | null {
  return db.select().from(schema.users).where(eq(schema.users.id, userId)).get() ?? null
}

function requireUser(c: Context, db: DB, now: () => number, authEnabled: boolean): UserRow | null {
  const session = readSession(c, db, now, authEnabled)
  if (!session) return null
  return readUser(db, session.userId)
}

function requireCsrf(c: Context, db: DB, now: () => number, authEnabled: boolean): Response | null {
  const header = c.req.header('x-csrf-token') ?? ''
  const cookie = getCookie(c, CSRF_COOKIE) ?? ''
  if (!header || !cookie || !safeEqual(header, cookie)) {
    return c.json({ error: 'Refresh the page and try again.' }, 403)
  }
  const session = readSession(c, db, now, authEnabled)
  if (session && !safeEqual(session.csrfToken, header)) {
    return c.json({ error: 'Refresh the page and try again.' }, 403)
  }
  return null
}

function accessFor(c: Context, db: DB, now: () => number, teamId: string, authEnabled: boolean) {
  const team = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).get()
  if (!team) return null
  const ownerToken = c.req.header('x-owner-token')
  const organization = findOrganization(db, ownerToken)
  const owned = Boolean(organization && team.organizationId && team.organizationId === organization.id)
  const share = shareOnTeam(team, c.req.header('x-share-token')) ?? (owned ? 'edit' : null)
  const user = requireUser(c, db, now, authEnabled)
  const membership = user
    ? db
        .select()
        .from(schema.memberships)
        .where(and(eq(schema.memberships.teamId, team.id), eq(schema.memberships.userId, user.id)))
        .get()
    : undefined
  const role = membership && isRole(membership.role) ? membership.role : null
  const isSample = team.isSample === 1 || team.id === SAMPLE_TEAM_ID
  if (!canReadTeam({ isSample, role, share })) return null
  return { team, role, isSample, share }
}

function seatWrite(access: { isSample: boolean; role: Role | null; share: ShareLevel | null }): Response | null {
  if (!canEditSeats({ isSample: access.isSample, role: access.role, share: access.share })) {
    const message = access.isSample
      ? 'The sample team is read-only.'
      : access.share === 'view'
        ? 'This view link is read-only.'
        : 'You do not have permission to edit seats.'
    return Response.json({ error: message }, { status: 403 })
  }
  return null
}

function issueSession(c: Context, db: DB, userId: string, env: AppEnv, stamp: number) {
  const token = randomToken()
  const csrfToken = randomToken()
  db.insert(schema.sessions)
    .values({
      tokenHash: sha256(token),
      userId,
      csrfToken,
      expiresAt: stamp + SESSION_TTL_MS,
    })
    .run()
  writeCookie(c, SESSION_COOKIE, token, env, SESSION_TTL_MS / 1000)
  writeCsrf(c, csrfToken, env, SESSION_TTL_MS)
  return { csrfToken }
}

function upsertUser(
  db: DB,
  input: { email: string; name: string | null; slackUserId: string | null; now: number },
): UserRow {
  const existing = db.select().from(schema.users).where(eq(schema.users.email, input.email)).get()
  if (existing) {
    const name = input.name ?? existing.name
    const slackUserId = input.slackUserId ?? existing.slackUserId
    db.update(schema.users).set({ name, slackUserId }).where(eq(schema.users.id, existing.id)).run()
    return { ...existing, name, slackUserId }
  }
  const created: UserRow = {
    id: newId(),
    email: input.email,
    name: input.name,
    slackUserId: input.slackUserId,
    createdAt: input.now,
  }
  db.insert(schema.users).values(created).run()
  return created
}

function applyEmailInvites(db: DB, user: UserRow, stamp: number) {
  const pending = db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.email, user.email), isNull(schema.invites.acceptedAt)))
    .all()
  for (const invite of pending) {
    if (invite.expiresAt < stamp || !isRole(invite.role)) continue
    const existing = db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.teamId, invite.teamId), eq(schema.memberships.userId, user.id)))
      .get()
    if (!existing) {
      db.insert(schema.memberships)
        .values({ teamId: invite.teamId, userId: user.id, role: invite.role, createdAt: stamp })
        .run()
    }
    db.update(schema.invites).set({ acceptedAt: stamp }).where(eq(schema.invites.id, invite.id)).run()
  }
}

function joinSlackWorkspace(
  db: DB,
  user: UserRow,
  profile: { teamId: string; teamName: string },
  catalog: CatalogBot[],
  stamp: number,
) {
  const existing = db.select().from(schema.teams).where(eq(schema.teams.slackTeamId, profile.teamId)).get()
  if (existing) {
    const member = db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.teamId, existing.id), eq(schema.memberships.userId, user.id)))
      .get()
    if (!member) {
      db.insert(schema.memberships)
        .values({ teamId: existing.id, userId: user.id, role: 'editor', createdAt: stamp })
        .run()
    }
    return existing.id
  }
  const id = newId()
  db.insert(schema.teams)
    .values({
      id,
      name: profile.teamName || 'Slack workspace',
      slackTeamId: profile.teamId,
      slackTeamName: profile.teamName,
      isSample: 0,
      createdAt: stamp,
    })
    .run()
  db.insert(schema.memberships)
    .values({ teamId: id, userId: user.id, role: 'owner', createdAt: stamp })
    .run()
  insertDefaultSeats(db, id, catalog)
  return id
}

function findInvite(db: DB, token: string, stamp: number) {
  const row = db.select().from(schema.invites).where(eq(schema.invites.tokenHash, sha256(token))).get()
  if (!row || row.expiresAt < stamp) return null
  if (row.email && row.acceptedAt) return null
  return row
}

function countOwners(db: DB, teamId: string) {
  return db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.teamId, teamId), eq(schema.memberships.role, 'owner')))
    .all().length
}

function readSeat(body: unknown, catalogSlugs: Set<string>) {
  if (!isRecord(body)) return 'Invalid seat.'
  const name = clip(body.name, 80)
  const role = clip(body.role, 120, true)
  const humanOwner = clip(body.humanOwner, 80, true)
  if (!name) return 'Seat name is required.'
  if (role === null || humanOwner === null) return 'Seat fields are too long.'
  let botSlug: string | null = null
  if (body.botSlug != null && body.botSlug !== '') {
    if (typeof body.botSlug !== 'string' || !catalogSlugs.has(body.botSlug)) {
      return 'Choose a bot from the catalog.'
    }
    botSlug = body.botSlug
  }
  return { name, role, humanOwner, botSlug }
}

export const MAX_BODY_BYTES = 100_000

function clientIp(c: Context, trustProxy: boolean): string {
  const socket = socketAddress(c)
  if (!trustProxy) return socket
  return lastHop(c.req.header('x-real-ip')) ?? lastHop(c.req.header('x-forwarded-for')) ?? socket
}

function socketAddress(c: Context): string {
  const env = c.env as { remoteAddress?: unknown } | undefined
  if (env && typeof env.remoteAddress === 'string') {
    const address = env.remoteAddress.trim().slice(0, 64)
    if (address) return address
  }
  return 'unknown'
}

function lastHop(header: string | undefined): string | undefined {
  if (!header) return undefined
  const hops = header.split(',').map((part) => part.trim()).filter(Boolean)
  const last = hops.at(-1)
  return last ? last.slice(0, 64) : undefined
}

function safeReturn(value: string | undefined): string {
  if (!value) return 'teams'
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(value)) return 'teams'
  return value
}

function slackRedirect(origin: string): string {
  return `${origin}/api/auth/slack/callback`
}

function cookieBase(env: AppEnv, maxAgeSeconds: number) {
  return {
    path: '/',
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax' as const,
    maxAge: Math.floor(maxAgeSeconds),
  }
}

function writeCookie(c: Context, name: string, value: string, env: AppEnv, maxAgeSeconds: number) {
  setCookie(c, name, value, cookieBase(env, maxAgeSeconds))
}

function writeCsrf(c: Context, token: string, env: AppEnv, maxAgeMs: number) {
  writeCookie(c, CSRF_COOKIE, token, env, maxAgeMs / 1000)
}

function clearCookie(c: Context, name: string, env: AppEnv) {
  deleteCookie(c, name, { path: '/', secure: env.cookieSecure, sameSite: 'Lax' })
}

function ensureAnonCsrf(c: Context, env: AppEnv): string {
  const existing = getCookie(c, CSRF_COOKIE)
  if (existing) return existing
  const token = randomToken()
  writeCsrf(c, token, env, 24 * 60 * 60 * 1000)
  return token
}

async function readBody(c: Context): Promise<unknown | 'too-big'> {
  const declared = Number(c.req.header('content-length') || '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return 'too-big'
  const body = c.req.raw.body
  if (!body) return null
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      return 'too-big'
    }
    chunks.push(value)
  }
  if (total === 0) return null
  const text = new TextDecoder().decode(Buffer.concat(chunks))
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function authDisabled(c: Context, env: AppEnv): Response | null {
  if (env.authEnabled) return null
  return c.json({ error: 'Sign-in is disabled.' }, 404)
}

function issueLinks(origin: string) {
  const editToken = randomToken(32)
  const viewToken = randomToken(32)
  return {
    editToken,
    viewToken,
    editTokenHash: sha256(editToken),
    viewTokenHash: sha256(viewToken),
    editUrl: `${origin}/#edit-${editToken}`,
    viewUrl: `${origin}/#view-${viewToken}`,
  }
}

function ownerUrl(origin: string, token: string): string {
  return `${origin}/#owner/${token}`
}

function findOrganization(db: DB, token: string | undefined) {
  if (!token) return null
  return db.select().from(schema.organizations).where(eq(schema.organizations.ownerTokenHash, sha256(token))).get() ?? null
}

function requireOwner(c: Context, db: DB) {
  const token = c.req.header('x-owner-token')
  const organization = findOrganization(db, token)
  if (!organization || !token) return null
  return { organization, token }
}

function readDay(value: unknown, required: boolean): string | null | 'bad' {
  if (value == null || value === '') return required ? 'bad' : null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'bad'
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'bad'
  return value
}

function listGoals(db: DB, organizationId: string) {
  const rows = db.select().from(schema.goals).where(eq(schema.goals.organizationId, organizationId)).all()
  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((goal) => {
      const milestones = db
        .select()
        .from(schema.milestones)
        .where(eq(schema.milestones.goalId, goal.id))
        .all()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          id: item.id,
          title: item.title,
          done: item.done === 1,
          dueOn: item.dueOn,
        }))
      return {
        id: goal.id,
        title: goal.title,
        dueOn: goal.dueOn,
        sortOrder: goal.sortOrder,
        milestones,
        progress: {
          done: milestones.filter((item) => item.done).length,
          total: milestones.length,
        },
      }
    })
}

function listActivity(db: DB, organizationId: string) {
  return db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.organizationId, organizationId))
    .all()
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((item) => ({ id: item.id, at: item.at, summary: item.summary, commitSha: item.commitSha }))
}

function teamChart(db: DB, teamId: string) {
  const seats = listSeats(db, teamId)
  const workstreams = db.select().from(schema.workstreams).where(eq(schema.workstreams.teamId, teamId)).all()
  const workstreamIds = new Set(workstreams.map((item) => item.id))
  const steps = db
    .select()
    .from(schema.steps)
    .all()
    .filter((item) => workstreamIds.has(item.workstreamId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => ({
      id: item.id,
      workstreamId: item.workstreamId,
      name: item.name,
      level: item.level,
      executorSeatId: item.executorSeatId,
      sortOrder: item.sortOrder,
    }))
  const stepIds = new Set(steps.map((item) => item.id))
  const handoffs = db
    .select()
    .from(schema.handoffs)
    .all()
    .filter((item) => workstreamIds.has(item.workstreamId))
    .map((item) => ({
      id: item.id,
      workstreamId: item.workstreamId,
      fromStepId: item.fromStepId,
      toStepId: item.toStepId,
    }))
  const checkpoints = db
    .select()
    .from(schema.checkpoints)
    .all()
    .filter((item) => stepIds.has(item.stepId))
    .map((item) => ({
      id: item.id,
      stepId: item.stepId,
      rule: item.rule,
      approverSeatId: item.approverSeatId,
      required: item.required === 1,
    }))
  return {
    seats,
    workstreams: workstreams.map((item) => ({
      id: item.id,
      outcome: item.outcome,
      ownerSeatId: item.ownerSeatId,
      kind: item.kind,
      triggerSource: item.triggerSource,
      triggerLabel: item.triggerLabel,
    })),
    steps,
    handoffs,
    checkpoints,
  }
}

function goalInOrg(db: DB, goalId: string, organizationId: string) {
  const goal = db.select().from(schema.goals).where(eq(schema.goals.id, goalId)).get()
  if (!goal || goal.organizationId !== organizationId) return null
  return goal
}

function milestoneInOrg(db: DB, milestoneId: string, organizationId: string) {
  const milestone = db.select().from(schema.milestones).where(eq(schema.milestones.id, milestoneId)).get()
  if (!milestone) return null
  const goal = db.select().from(schema.goals).where(eq(schema.goals.id, milestone.goalId)).get()
  if (!goal || goal.organizationId !== organizationId) return null
  return milestone
}

function sealPair(ownerToken: string, editToken: string, viewToken: string): string {
  return sealSecret(ownerToken, JSON.stringify({ editToken, viewToken }))
}

function openPair(ownerToken: string, sealed: string | null): { editToken: string; viewToken: string } | null {
  if (!sealed) return null
  const raw = openSecret(ownerToken, sealed)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { editToken?: unknown; viewToken?: unknown }
    if (typeof parsed.editToken !== 'string' || typeof parsed.viewToken !== 'string') return null
    return { editToken: parsed.editToken, viewToken: parsed.viewToken }
  } catch {
    return null
  }
}

function urlsFor(
  origin: string,
  pair: { editToken: string; viewToken: string } | null,
  team: { editTokenHash: string | null; viewTokenHash: string | null },
): { editUrl: string | null; viewUrl: string | null } {
  if (!pair || !team.editTokenHash || !team.viewTokenHash) return { editUrl: null, viewUrl: null }
  if (!safeEqual(sha256(pair.editToken), team.editTokenHash) || !safeEqual(sha256(pair.viewToken), team.viewTokenHash)) {
    return { editUrl: null, viewUrl: null }
  }
  return {
    editUrl: `${origin}/#edit-${pair.editToken}`,
    viewUrl: `${origin}/#view-${pair.viewToken}`,
  }
}

function listOwnedTeams(db: DB, organizationId: string, ownerToken: string, origin: string) {
  return db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.organizationId, organizationId))
    .all()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((team) => {
      const urls = urlsFor(origin, openPair(ownerToken, team.linkSeal), team)
      return { id: team.id, name: team.name, editUrl: urls.editUrl, viewUrl: urls.viewUrl }
    })
}

function parseTeamLink(value: string): { kind: 'edit'; token: string } | { kind: 'view' } | { kind: 'invalid' } {
  const hash = value.includes('#') ? value.slice(value.indexOf('#') + 1) : value.trim()
  const path = hash.split('?')[0] ?? ''
  if (path.startsWith('view-')) return { kind: 'view' }
  if (path.startsWith('edit-') && path.length > 'edit-'.length + 16) return { kind: 'edit', token: path.slice('edit-'.length) }
  if (/^[A-Za-z0-9_-]{32,}$/.test(value.trim())) return { kind: 'edit', token: value.trim() }
  return { kind: 'invalid' }
}

function shareOnTeam(
  team: { editTokenHash: string | null; viewTokenHash: string | null; isSample: number },
  token: string | undefined,
): ShareLevel | null {
  if (!token || team.isSample === 1) return null
  const hash = sha256(token)
  if (team.editTokenHash && safeEqual(team.editTokenHash, hash)) return 'edit'
  if (team.viewTokenHash && safeEqual(team.viewTokenHash, hash)) return 'view'
  return null
}

function findByShareToken(db: DB, token: string | undefined) {
  if (!token) return null
  const hash = sha256(token)
  const byEdit = db.select().from(schema.teams).where(eq(schema.teams.editTokenHash, hash)).get()
  if (byEdit && byEdit.isSample !== 1) return { team: byEdit, access: 'edit' as const }
  const byView = db.select().from(schema.teams).where(eq(schema.teams.viewTokenHash, hash)).get()
  if (byView && byView.isSample !== 1) return { team: byView, access: 'view' as const }
  return null
}

function hitRateLimit(
  db: DB,
  input: { bucket: string; ip: string; limit: number; windowMs: number; stamp: number },
): boolean {
  db.delete(schema.rateEvents)
    .where(lt(schema.rateEvents.createdAt, input.stamp - 60 * 60 * 1000))
    .run()
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.rateEvents)
    .where(
      and(
        eq(schema.rateEvents.bucket, input.bucket),
        eq(schema.rateEvents.ip, input.ip),
        gte(schema.rateEvents.createdAt, input.stamp - input.windowMs),
      ),
    )
    .get()
  if (Number(row?.n ?? 0) >= input.limit) return true
  db.insert(schema.rateEvents)
    .values({ bucket: input.bucket, ip: input.ip, createdAt: input.stamp })
    .run()
  return false
}

function isSampleApi(path: string): boolean {
  return path === '/api/teams/sample' || path.startsWith('/api/teams/sample/')
}
