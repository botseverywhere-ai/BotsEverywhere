import { eq } from 'drizzle-orm'
import * as schema from './schema.js'
import { randomToken, sealSecret, sha256 } from './crypto.js'
import type { DB } from './db.js'

/** Fixed ids so a second run does not create another organization. */
export const ORG_ID = 'org-botseverywhere'
export const TEAM_ID = 'team-botseverywhere'
export const GOAL_ID = 'goal-nov7-2026'

export type CardProvenance = {
  owns: string
  may: string
  mustAskBefore: string
  doneWhen: string
}

const profileSource: CardProvenance = {
  owns: 'profile',
  may: 'profile',
  mustAskBefore: 'profile',
  doneWhen: 'profile',
}

const empty = { owns: '', may: '', mustAskBefore: '', doneWhen: '', provenance: { owns: '', may: '', mustAskBefore: '', doneWhen: '' } }

/**
 * Seat-card prose copied from seat cards v1.1 (15 Oct 2026).
 * The handbook tag stays in the stored text. The screen strips it.
 */
const cards = {
  sam: empty,
  grok: {
    owns: 'routing tasks to the right bot; managing all botseverywhere work; weekly shipping goal; daily 18:15 summary to the owner.',
    may: 'route work to the right bot and set one shipping goal a week (profile + handbook v1); receive status, reviews, and hiring proposals from every botseverywhere bot (from handbook v1: all bots report to Grok Bot).',
    mustAskBefore: 'sending messages/emails, public posts, spending, merging to main, production deploys, DNS, secrets, deleting, new access, logins before Nov 7 (from handbook v1).',
    doneWhen: 'the week\'s shipping goal is set, work is routed to the bot whose lane owns it, and the weekday 18:15 summary reaches the owner with current status from every bot (from handbook v1; profile says "daily").',
    provenance: {
      owns: 'profile',
      may: 'profile + handbook v1',
      mustAskBefore: 'handbook v1',
      doneWhen: 'handbook v1',
    },
  },
  outer: {
    owns: 'context before code (repo, libraries, competitors, X signals the owner shares); scoped prompts to Build Bot; testing, integration, screenshot/video verification, Cloudflare/EC2 preview deploys; proposing skills/routines/loop bots.',
    may: 'research web/repos (read-only)/docs/competitors; send build prompts to Build Bot; run preview deploys and verification.',
    mustAskBefore: 'production deploys, DNS, paid services, secrets, deleting branches/data, merging to main, public posts, changes to the product lock.',
    doneWhen: 'preview URL works, screenshots/video prove it, the owner gets a short report (shipped / broke / next prompt).',
    provenance: profileSource,
  },
  inner: {
    owns: 'running scoped prompts through the coding agent to green tests; small branch + PR changes with summaries; honest failure reports.',
    may: 'launch/steer cloud coding agents on botseverywhere repos, create branches/PRs, run tests and local previews; ask Planning Bot for context.',
    mustAskBefore: 'merging to main, production deploys, secrets/paid services, deleting code/branches, large out-of-scope refactors, logins/auth before Nov 7.',
    doneWhen: 'tests pass, PR open with summary, Planning Bot can verify and preview-deploy.',
    provenance: profileSource,
  },
  research: {
    owns: 'product thesis (source: Deloitte 16 Jun 2026 work chart article, no partnership claim); milestones; build log (Outer→Build Bot hand-off) for example.com; drafts in Shared-Grokbot-ClaudeCode; milestone briefs for x.com.',
    may: "research web/docs/teammates' context; draft/update docs in the shared folder.",
    mustAskBefore: 'publishing, posting publicly, naming real people, changing the product lock.',
    doneWhen: 'each milestone has an accurate, sourced draft in the shared folder and a brief for X.',
    provenance: profileSource,
  },
  brand: {
    owns: 'brand kit (exact logo PNG lock, palette, Inter, wordmark, tagline "Org chart for bots. Work chart for humans."); product UI mockups/design system; landing visuals, emails/decks/CTAs, social creative, non-X copy; org-vs-work-chart diagrams.',
    may: 'deliver reviewable PNG/HTML in brand-kit paths when the owner asks for mockups or design; brief angles and creative to x.com; hand final screens to Planning Bot (all from profile).',
    mustAskBefore: 'sending messages/emails, public posts, spending, merging to main, production deploys, DNS, secrets, deleting, new access, logins before Nov 7 (from handbook v1). From profile: never regenerate the logo (composite the exact PNG only); no third-party marks.',
    doneWhen: 'finished work is returned (from handbook v1): reviewable PNG/HTML in brand-kit paths, final screens handed to Planning Bot (profile), status kept current for the 18:15 summary (from handbook v1).',
    provenance: {
      owns: 'profile',
      may: 'profile',
      mustAskBefore: 'profile + handbook v1',
      doneWhen: 'profile + handbook v1',
    },
  },
  x: {
    owns: 'polished X posts/threads on the build-up, milestones, cross-links to example.com.',
    may: "draft posts and threads from Research briefs and the owner's input; after the owner approves the exact text, post via the connected X account (profile).",
    mustAskBefore: 'posting anything. Every post, thread, or reply is a draft first and needs the owner\'s approval of the exact text, with no exceptions (from handbook v1: must-ask is absolute, public posts). The profile\'s "unless he explicitly says to post without preview" exception is removed here; the profile itself still contains it until the owner approves a rewrite.',
    doneWhen: 'the post the owner approved is live and confirmed with the live link or post id (profile: "confirm with the live link or post id").',
    provenance: {
      owns: 'profile',
      may: 'profile',
      mustAskBefore: 'handbook v1',
      doneWhen: 'profile',
    },
  },
  hr: {
    owns: 'hiring seat cards; onboarding notes; weekly reviews; the roster.',
    may: "read other bots' descriptions and ask them about their work; draft cards, notes, reviews.",
    mustAskBefore: 'creating/renaming/retiring/rewriting any bot, granting access, publishing.',
    doneWhen: 'every bot on the roster has a current seat card, new hires have an approved card and onboarding note, and the weekly review is delivered (profile).',
    provenance: profileSource,
  },
  product: {
    owns: 'launch demo scope (prioritized in/out list); dummy orgs (accounting firm, clinic, cybersecurity team, small agency) as data specs, no real people or organization data; launch demo script; acceptance criteria per feature.',
    may: "read other bots' work, draft specs and scripts, propose scope cuts.",
    mustAskBefore: 'changing the product lock, adding scope after 31 Oct, publishing.',
    doneWhen: 'every in-scope feature has spec + criteria, dummy orgs ready, demo script approved.',
    provenance: profileSource,
  },
  qa: {
    owns: 'testing every preview build (demo script + criteria, desktop/mobile, links, console errors, copy vs mockups); test report per build with screenshots and repro steps; growing regression checklist.',
    may: 'open previews, run the app locally/in browser, file bugs to Planning Bot.',
    mustAskBefore: 'testing production, touching real data/accounts, changing code.',
    doneWhen: 'build passes every criterion + regression checklist, report with Planning Bot and Grok Bot.',
    provenance: profileSource,
  },
  sales: {
    owns: 'lead list (attendees of the next launch event and local meetups); one-page pitch + pilot plan per segment (finance, healthcare, cybersecurity, agencies); post-demo follow-up drafts; partnership ideas.',
    may: 'research organizations and public contacts; draft pitches, emails, DMs.',
    mustAskBefore: 'sending any message; offering prices/discounts/terms; naming a partner publicly.',
    doneWhen: 'each lead has status + next step; all follow-up drafts ready within a day of the demo.',
    provenance: profileSource,
  },
  finance: {
    owns: 'cost tracker (AWS EC2, Hostinger, X API credits, xAI credits, coding tools, others); weekly spend summary and low-balance/cost-jump alerts; ops checklists (renewals, domains, what must run for Nov 7).',
    may: 'read billing/usage data the owner shares; draft budgets/checklists.',
    mustAskBefore: 'any purchase, top-up, subscription change, cancellation, payment, billing-setting change.',
    doneWhen: 'tracker current, weekly summary delivered, nothing renews/runs out unwarned.',
    provenance: profileSource,
  },
  security: {
    owns: 'secrets hygiene (no keys in frontend/repo; xAI/X keys server-side with spend limits); EC2 setup review checklists; security review of PRs/deploy plans; pre-demo checklist; least-privilege access per bot.',
    may: "read repo/PRs/configs/public endpoints; safe scans of botseverywhere's own sites; draft fixes as prompts for Planning Bot.",
    mustAskBefore: 'changing any server/DNS/firewall/key/account setting; rotating/revoking credentials; scanning non-owned targets.',
    doneWhen: "no secrets exposed, pre-demo checklist passes, every bot's access matches its seat card.",
    provenance: profileSource,
  },
  automations: {
    owns: "automations register (routines, schedules, listeners, Make.com scenarios, local pipelines: owner, trigger, action, output, last worked); proposals for repeated manual steps (as seat cards); health checks (failing, quiet, duplicate, spammy); phone-first approvals during the owner's 10:00–18:00 job.",
    may: "read other bots' routines/outputs; draft automations and fixes.",
    mustAskBefore: 'creating/changing/pausing/deleting any automation; anything that sends, spends, or acts in an outside account.',
    doneWhen: "register current, every automation owned and working, proposals waiting for the owner's OK.",
    provenance: profileSource,
  },
  ux: {
    owns: 'user flows, information architecture, wireframes, interaction and usability specs, accessibility and mobile checks, UX acceptance criteria for each screen (profile).',
    may: "read the repo and preview builds; read Product's scope and Brand's mockups; write specs into /workspace/ux/; hand specs to Planning Bot (profile).",
    mustAskBefore: 'sending or posting anything, spending money, merging, deploying, touching DNS or secrets, deleting anything, requesting new access (profile). Logins before Nov 7 (from handbook v1).',
    doneWhen: 'each demo screen has a flow, a wireframe or spec, and UX acceptance criteria that Planning Bot has accepted and QA can test (profile).',
    provenance: {
      owns: 'profile',
      may: 'profile',
      mustAskBefore: 'profile + handbook v1',
      doneWhen: 'profile',
    },
  },
} as const

type Card = { owns: string; may: string; mustAskBefore: string; doneWhen: string; provenance: CardProvenance }

interface SeatSeed {
  id: string
  name: string
  role: string
  kind: 'human' | 'bot'
  reportsTo: string | null
  card: Card
}

export const SEEDED_SEATS: SeatSeed[] = [
  { id: 'seat-sam', name: 'Sam Rivera', role: 'Owner', kind: 'human', reportsTo: null, card: cards.sam },
  { id: 'seat-grok', name: 'Grok Bot', role: 'Manager', kind: 'bot', reportsTo: 'seat-sam', card: cards.grok },
  { id: 'seat-planning-bot', name: 'Planning Bot', role: 'Turns research into a build prompt', kind: 'bot', reportsTo: 'seat-grok', card: cards.outer },
  { id: 'seat-build-bot', name: 'Build Bot', role: 'Builds the change', kind: 'bot', reportsTo: 'seat-grok', card: cards.inner },
  { id: 'seat-research-bot', name: 'Research Bot', role: 'Researches the question', kind: 'bot', reportsTo: 'seat-grok', card: cards.research },
  { id: 'seat-marketing-bot', name: 'Marketing Bot', role: 'Drafts brand and marketing', kind: 'bot', reportsTo: 'seat-grok', card: cards.brand },
  { id: 'seat-social-bot', name: 'Social Post Bot', role: 'Drafts social posts', kind: 'bot', reportsTo: 'seat-grok', card: cards.x },
  { id: 'seat-hr-bot', name: 'HR Bot', role: 'Handles hiring and the roster', kind: 'bot', reportsTo: 'seat-grok', card: cards.hr },
  { id: 'seat-product-bot', name: 'Product Bot', role: 'Writes the spec', kind: 'bot', reportsTo: 'seat-grok', card: cards.product },
  { id: 'seat-qa-bot', name: 'QA Bot', role: 'Tests the build', kind: 'bot', reportsTo: 'seat-grok', card: cards.qa },
  { id: 'seat-sales-bot', name: 'Sales Bot', role: 'Handles sales follow-up', kind: 'bot', reportsTo: 'seat-grok', card: cards.sales },
  { id: 'seat-finance-bot', name: 'Finance Bot', role: 'Handles invoices and spend', kind: 'bot', reportsTo: 'seat-grok', card: cards.finance },
  { id: 'seat-security-bot', name: 'Security Bot', role: 'Checks for security issues', kind: 'bot', reportsTo: 'seat-grok', card: cards.security },
  { id: 'seat-automation-bot', name: 'Automation Bot', role: 'Keeps the routines running', kind: 'bot', reportsTo: 'seat-grok', card: cards.automations },
  { id: 'seat-design-bot', name: 'Design Bot', role: 'Designs the screens', kind: 'bot', reportsTo: 'seat-grok', card: cards.ux },
]

/**
 * Commit subjects and timestamps, mapped to the seat that did the work.
 * onMain is true only when that commit is on main. Those are the owner's recorded
 * approvals to land the work. Branch-only commits are not approvals.
 */
export const ACTIVITY = [
  { sha: '7ad063a102df1bf2bb3c9616196cdb770e69bc34', at: '2026-10-14T20:13:08+00:00', summary: 'Initialize project', seatId: 'seat-build-bot', onMain: true },
  { sha: '7c4d1011bf91bb5c36814d5602d94ea415987c34', at: '2026-10-14T20:43:07+00:00', summary: 'Add the Nov 7 BotsEverywhere demo app', seatId: 'seat-build-bot', onMain: true },
  { sha: '8d61e8221422c691a9141eb7fcc2237901132c41', at: '2026-10-14T20:50:35+00:00', summary: 'Replace seat mascots with the bots-index robots', seatId: 'seat-marketing-bot', onMain: true },
  { sha: 'fadf61f5b2cdd95e5e76d2583f92b2f25e49052d', at: '2026-10-14T20:59:10+00:00', summary: 'Use the official tree mark and capital-E wordmark', seatId: 'seat-marketing-bot', onMain: true },
  { sha: '2a7926db19ddab732ebeba8bdef3dc66616dec33', at: '2026-10-14T21:01:09+00:00', summary: 'Update the landing hero and charts heading', seatId: 'seat-marketing-bot', onMain: true },
  { sha: '4876e3af06561c9124c2f224b150e9b740bcb563', at: '2026-10-14T21:03:09+00:00', summary: 'Enlarge the header and footer lockup', seatId: 'seat-marketing-bot', onMain: true },
  { sha: '2da517977ce71388a3affbe4c961f30addc34999', at: '2026-10-14T21:20:12+00:00', summary: 'Add private teams, passwordless auth, and a bot catalog', seatId: 'seat-build-bot', onMain: true },
  { sha: '60a4bfa3520a696702257eea07917129a4287b63', at: '2026-10-14T21:20:18+00:00', summary: 'Add the curated bot markdown files the catalog validator reads', seatId: 'seat-build-bot', onMain: true },
  { sha: 'b69b9c8223323115216846ecdb6e7c82a9c212b3', at: '2026-10-14T21:26:30+00:00', summary: 'Add how-it-works and security notes under sign-in', seatId: 'seat-build-bot', onMain: true },
  { sha: '4ebcd710f8a8a67a4113355bf052c2d46dfd7066', at: '2026-10-14T21:45:18+00:00', summary: 'Add share-link teams and gate email and Slack sign-in', seatId: 'seat-build-bot', onMain: false },
  { sha: 'febf1cca550e04f61834b4287cfc07617f917ddd', at: '2026-10-14T22:22:17+00:00', summary: 'Add sample organization charts and scroll the org tree natively', seatId: 'seat-build-bot', onMain: false },
  { sha: 'e91fcf78a4894386d07105cb2fb930ddd5eeb274', at: '2026-10-14T22:28:44+00:00', summary: 'Add an organization owner link that opens every owned team', seatId: 'seat-build-bot', onMain: false },
  { sha: 'd4804110d1b17754e8702440260329fe2b3a8996', at: '2026-10-14T23:09:00+00:00', summary: 'Add organization goals and seed the botseverywhere owner org', seatId: 'seat-build-bot', onMain: false },
  { sha: 'e634f71e04ae947b8af9e2a5d78d24bfcb7ca1cf', at: '2026-10-14T23:14:18+00:00', summary: 'Stop trusting spoofed client addresses and cap request bodies', seatId: 'seat-security-bot', onMain: false },
  { sha: '70ab83576f2c1f023111a9f777c6817ed52ab337', at: '2026-10-14T23:28:27+00:00', summary: 'Add the Oct 15 preview with work charts, hire, and retire', seatId: 'seat-build-bot', onMain: false },
  { sha: '6810630390ab854703b2f77d5d4d62a59efcf84b', at: '2026-10-14T23:28:48+00:00', summary: 'Add a Hire bot action on the work chart', seatId: 'seat-build-bot', onMain: false },
  { sha: 'ccdc18f62e45e6a75471c8bba39ddda69088aaa5', at: '2026-10-14T23:36:06+00:00', summary: 'Fill every owner-org bot card from the v1.1 seat cards', seatId: 'seat-hr-bot', onMain: false },
] as const

/** QA's recorded run against PR #1. Not a commit. */
export const QA_RUN = {
  at: '2026-10-15T06:05:00+00:00',
  summary: 'QA report for PR #1 at ccdc18f',
  seatId: 'seat-qa-bot',
} as const

const MILESTONES = [
  'share-link teams',
  'mock sample organizations',
  'app redesign',
  'owner link',
  'deploy to botseverywhere.ai on EC2',
] as const

export type SeedResult = { created: false } | { created: true; ownerUrl: string; ownerToken: string }

export function seedBotseverywhere(db: DB, input: { origin: string; now?: number }): SeedResult {
  const existing = db.select().from(schema.organizations).where(eq(schema.organizations.id, ORG_ID)).get()
  if (existing) return { created: false }

  const now = input.now ?? Date.now()
  const ownerToken = randomToken(32)
  const editToken = randomToken(32)
  const viewToken = randomToken(32)
  const origin = input.origin.replace(/\/$/, '')

  for (const [index, seat] of SEEDED_SEATS.entries()) {
    db.insert(schema.seats)
      .values({
        id: seat.id,
        teamId: TEAM_ID,
        name: seat.name,
        role: seat.role,
        botSlug: null,
        humanOwner: 'Sam Rivera',
        sortOrder: index,
        kind: seat.kind,
        reportsTo: seat.reportsTo,
        owns: seat.card.owns,
        may: seat.card.may,
        mustAskBefore: seat.card.mustAskBefore,
        doneWhen: seat.card.doneWhen,
        cardProvenance: seat.card.provenance.owns ? JSON.stringify(seat.card.provenance) : '',
      })
      .run()
  }

  db.insert(schema.workstreams)
    .values({
      id: 'ws-nov7',
      teamId: TEAM_ID,
      outcome: 'Nov 7 2026 demo',
      ownerSeatId: 'seat-sam',
      kind: 'main',
      triggerSource: 'management',
      triggerLabel: 'Nov 7 2026 demo',
    })
    .run()

  const steps = [
    { id: 'step-spec', name: 'Write the spec', executorSeatId: 'seat-product-bot' },
    { id: 'step-outer', name: 'Turn research into a build prompt', executorSeatId: 'seat-planning-bot' },
    { id: 'step-inner', name: 'Build the change', executorSeatId: 'seat-build-bot' },
    { id: 'step-qa', name: 'Test the build', executorSeatId: 'seat-qa-bot' },
  ]
  steps.forEach((step, index) => {
    db.insert(schema.steps)
      .values({
        id: step.id,
        workstreamId: 'ws-nov7',
        name: step.name,
        level: 2,
        executorSeatId: step.executorSeatId,
        sortOrder: index,
      })
      .run()
  })

  const edges = [
    ['hand-spec-outer', 'step-spec', 'step-outer'],
    ['hand-outer-inner', 'step-outer', 'step-inner'],
    ['hand-inner-qa', 'step-inner', 'step-qa'],
    ['hand-qa-outer', 'step-qa', 'step-outer'],
  ] as const
  for (const [id, fromStepId, toStepId] of edges) {
    db.insert(schema.handoffs).values({ id, workstreamId: 'ws-nov7', fromStepId, toStepId }).run()
  }

  db.insert(schema.checkpoints)
    .values({
      id: 'cp-owner-merge',
      stepId: 'step-outer',
      rule: 'The owner approves merges to main and production deploys.',
      approverSeatId: 'seat-sam',
      required: 1,
    })
    .run()

  db.insert(schema.goals)
    .values({
      id: GOAL_ID,
      organizationId: ORG_ID,
      title: 'Nov 7 2026 demo',
      dueOn: '2026-11-07',
      sortOrder: 0,
    })
    .run()
  MILESTONES.forEach((title, index) => {
    db.insert(schema.milestones)
      .values({
        id: `ms-nov7-${index}`,
        goalId: GOAL_ID,
        title,
        done: 0,
        dueOn: null,
        sortOrder: index,
      })
      .run()
  })

  for (const event of ACTIVITY) {
    db.insert(schema.activityLog)
      .values({
        id: `act-${event.sha.slice(0, 12)}`,
        organizationId: ORG_ID,
        at: event.at,
        summary: event.summary,
        commitSha: event.sha,
      })
      .run()
  }

  db.insert(schema.teams)
    .values({
      id: TEAM_ID,
      name: 'botseverywhere',
      slackTeamId: null,
      slackTeamName: null,
      isSample: 0,
      createdAt: now,
      editTokenHash: sha256(editToken),
      viewTokenHash: sha256(viewToken),
      organizationId: ORG_ID,
      linkSeal: sealSecret(ownerToken, JSON.stringify({ editToken, viewToken })),
    })
    .run()

  db.insert(schema.organizations)
    .values({
      id: ORG_ID,
      name: 'botseverywhere',
      ownerTokenHash: sha256(ownerToken),
      createdAt: now,
    })
    .run()

  return {
    created: true,
    ownerToken,
    ownerUrl: `${origin}/#owner/${ownerToken}`,
  }
}
