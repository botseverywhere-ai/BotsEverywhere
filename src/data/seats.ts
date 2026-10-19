/** Curated sample bots for the Nov 7 2026 demo. Static only — nothing to log into. */

export type SeatId = 'founder' | 'research' | 'writing' | 'site' | 'ops'
export type BotKind = 'research' | 'writing' | 'site' | 'ops'
export type SeatStatus = 'staffed' | 'review' | 'empty' | 'human'

export interface Integration {
  name: string
  hint: string
}

export interface Seat {
  id: SeatId
  /** Chart and side-panel label. */
  name: string
  /** Seat-page heading. */
  detailName: string
  mascot: BotKind | null
  /** Tile glyph used on the initiative map (product mock). */
  icon: string
  accent: string
  /** One line under the name on the team canvas. */
  canvasMeta: string
  /** One line on the org-style initiative seat. */
  orgMeta: string
  /** One line on the work-initiative seat. */
  workMeta: string
  reportsTo: string
  role: string
  purpose: string
  job: string
  does: string[]
  /** Landing card bullets — shorter public phrasing. */
  landingDoes: string[]
  landingBlurb: string
  approve: string
  now: string
  /** Status once the seat is on the chart. The Ops slot can still render empty. */
  status: SeatStatus
  addable: boolean
  integrations: Integration[]
}

export const seats: Record<SeatId, Seat> = {
  founder: {
    id: 'founder',
    name: 'Founder / PM',
    detailName: 'Founder / PM',
    mascot: null,
    icon: '👤',
    accent: '#111111',
    canvasMeta: 'Owns the approve',
    orgMeta: 'Approve gate · Strategy & accountability',
    workMeta: 'Decisions & exceptions · you keep the approve',
    reportsTo: 'Owns the approve',
    role: 'Human approve gate · Strategy & accountability',
    purpose:
      'You keep the approve. Decisions, exceptions, and the final ship call on every seat output.',
    job: 'Owns the approve. Strategy, exceptions, and accountability stay with you.',
    does: [
      'Approves drafts before anything ships',
      'Decides exceptions and the final call',
      'Keeps the team lean',
    ],
    landingDoes: [],
    landingBlurb: 'Owns the approve',
    approve: 'Nothing ships without your yes. You keep the call.',
    now: 'Launch post for Grok Bot Alicante is waiting on you.',
    status: 'human',
    addable: false,
    integrations: [{ name: 'You', hint: 'approve gate' }],
  },
  research: {
    id: 'research',
    name: 'Research Bot',
    detailName: 'Research Bot',
    mascot: 'research',
    icon: '🔍',
    accent: '#111111',
    canvasMeta: 'Facts and briefs',
    orgMeta: 'Bot · Sense & synthesize',
    workMeta: 'Bot · Brief for narrative',
    reportsTo: 'Reports to you · Founder / PM',
    role: 'Seat on work chart · Sense & synthesize',
    purpose:
      'Discover, synthesize, and brief. Turn signals into structured insight for the Nov 7 narrative.',
    job: 'Finds the facts so you don’t have to. Turns signals into a brief the other seats can use.',
    does: ['Market and competitor scans', 'Source-checked briefs', 'Flags uncertainty instead of inventing numbers'],
    landingDoes: ['Market and competitor scans', 'Source-checked briefs'],
    landingBlurb: 'Finds the facts so you don’t have to.',
    approve: 'Briefs stay drafts until you accept the findings.',
    now: 'Source check for the Nov 7 narrative is underway.',
    status: 'staffed',
    addable: true,
    integrations: [
      { name: 'Grok Bot', hint: 'run seat' },
      { name: 'Web search', hint: 'setup hint' },
      { name: 'Notion', hint: 'optional brief sink' },
    ],
  },
  writing: {
    id: 'writing',
    name: 'Social Post Bot',
    detailName: 'Social Post Bot',
    mascot: 'writing',
    icon: '✍️',
    accent: '#111111',
    canvasMeta: 'Posts and launch copy',
    orgMeta: 'Bot · Short posts, human approve',
    workMeta: 'Bot · Draft posts → approve',
    reportsTo: 'Reports to you · Founder / PM',
    role: 'Seat on work chart · Short posts, human approve',
    purpose:
      'Turn the research brief into X-ready posts and a short narrative. Always draft-first for human approve.',
    job: 'Turns your ideas into X posts and launch copy that sound like you. Short, warm, direct.',
    does: ['Drafts posts and short threads', 'Writes launch and event copy', 'Matches your voice'],
    landingDoes: ['X posts and threads', 'Launch copy drafts'],
    landingBlurb: 'Turns ideas into posts that sound like you.',
    approve: 'Nothing gets posted until you say yes.',
    now: 'Launch post for Grok Bot Alicante is ready for you.',
    status: 'review',
    addable: true,
    integrations: [
      { name: 'Grok Bot', hint: 'run seat' },
      { name: 'X', hint: 'publish after approve' },
    ],
  },
  site: {
    id: 'site',
    name: 'Website Bot',
    detailName: 'Website Bot',
    mascot: 'site',
    icon: '🌐',
    accent: '#111111',
    canvasMeta: 'Pages and fixes',
    orgMeta: 'Bot · Drafts → publish path',
    workMeta: 'Bot + Claude path · Publish',
    reportsTo: 'Reports to you · Founder / PM',
    role: 'Seat on work chart · Drafts → publish path',
    purpose:
      'Prepare site and page drafts for the demo narrative. Hand off a clean package when it is ready to publish.',
    job: 'Keeps your pages fresh and shipped. Drafts the page, then waits for your yes.',
    does: ['Landing page updates', 'Copy and layout fixes'],
    landingDoes: ['Landing page updates', 'Copy and layout fixes'],
    landingBlurb: 'Keeps your pages fresh and shipped.',
    approve: 'Nothing goes live until you say yes.',
    now: 'Landing update for the Nov 7 demo is in progress.',
    status: 'staffed',
    addable: true,
    integrations: [
      { name: 'Grok Bot', hint: 'draft seat' },
      { name: 'Claude path', hint: 'publish handoff' },
    ],
  },
  ops: {
    id: 'ops',
    name: 'Ops Bot',
    detailName: 'Ops Bot',
    mascot: 'ops',
    icon: '⚙️',
    accent: '#111111',
    canvasMeta: 'Inbox and follow-ups',
    orgMeta: 'Bot · Recurring / intake classify',
    workMeta: 'Not on this initiative yet',
    reportsTo: 'Reports to you · Founder / PM',
    role: 'Seat · Recurring / intake classify',
    purpose:
      'Classify intake — Directive, Objective, Problem, or Event — and route it to the right work chart.',
    job: 'Handles the busywork that keeps things moving. Classifies intake and keeps follow-ups on track.',
    does: ['Inbox and follow-ups', 'Status and checklists'],
    landingDoes: ['Inbox and follow-ups', 'Status and checklists'],
    landingBlurb: 'Handles the busywork that keeps things moving.',
    approve: 'You approve anything that leaves the building.',
    now: 'Ready to classify intake once this seat is staffed.',
    status: 'staffed',
    addable: true,
    integrations: [
      { name: 'Grok Bot', hint: 'run seat' },
      { name: 'Intake chips', hint: 'Directive / Objective / Problem / Event' },
    ],
  },
}

export const BOT_IDS: BotKind[] = ['research', 'writing', 'site', 'ops']

const SEAT_IDS: SeatId[] = ['founder', 'research', 'writing', 'site', 'ops']

export function isSeatId(value: string): value is SeatId {
  return (SEAT_IDS as string[]).includes(value)
}

export interface WorkTask {
  id: string
  title: string
  meta: string
  column: 'intake' | 'working' | 'approve' | 'outcome'
  seatId?: SeatId
  accent: string
}

export const WORK_TASKS: WorkTask[] = [
  {
    id: 'announce',
    title: 'Announce the demo',
    meta: 'From you',
    column: 'intake',
    seatId: 'founder',
    accent: '#0B1220',
  },
  {
    id: 'facts',
    title: 'Check event facts',
    meta: 'Research · done',
    column: 'working',
    seatId: 'research',
    accent: '#111111',
  },
  {
    id: 'landing',
    title: 'Update landing',
    meta: 'Site · working',
    column: 'working',
    seatId: 'site',
    accent: '#111111',
  },
  {
    id: 'post',
    title: 'Launch post draft',
    meta: 'Social Post Bot · waiting on you',
    column: 'approve',
    seatId: 'writing',
    accent: '#111111',
  },
  {
    id: 'live',
    title: 'Post + page live',
    meta: 'After your yes',
    column: 'outcome',
    accent: '#111111',
  },
]
