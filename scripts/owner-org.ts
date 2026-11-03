/**
 * Bot Company X, the fictional owner organization in the sample data: one maintainer and the bots that keep an open
 * source toolkit for bots and AI agents healthy. Every bot, issue, contributor, and number here is made up.
 * build-preview-seed.ts turns it into src/data/mock-companies.json.
 */
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
 * Seat cards for Bot Company X, a fictional open source project: one maintainer and a team of bots that keep a
 * toolkit for bots and AI agents healthy. Every bot, issue, contributor, and number here is made up. The handbook tag
 * stays in the stored text; the screen strips it.
 */
const cards = {
  sam: empty,
  grok: {
    owns: 'routing tasks to the right bot; managing all project work; the weekly release goal; the daily 18:00 summary to the maintainer.',
    may: 'route work to the right bot and set one goal a week (profile + handbook v1); receive status and proposals from every project bot (from handbook v1: all bots report to Grok Bot).',
    mustAskBefore: 'merging, releasing, replying in public, spending, deleting anything, new access (from handbook v1).',
    doneWhen: 'the week\'s goal is set, work is routed to the bot whose lane owns it, and the 18:00 summary reaches the maintainer with current status from every bot (from handbook v1).',
    provenance: {
      owns: 'profile',
      may: 'profile + handbook v1',
      mustAskBefore: 'handbook v1',
      doneWhen: 'handbook v1',
    },
  },
  issues: {
    owns: 'new issues: labels, the missing-information list, and a draft reply for each one within a day.',
    may: 'read issues, the code, and the docs; propose labels; draft replies that thank the person and ask for what is missing.',
    mustAskBefore: 'posting any reply; closing an issue; promising a fix or a date.',
    doneWhen: 'every new issue has labels proposed and a draft reply waiting for the maintainer.',
    provenance: profileSource,
  },
  review: {
    owns: 'the first-pass review of every pull request: tests, the diff against the project rules, and a plain-words review draft.',
    may: 'read pull requests and run the tests on a branch; draft reviews; ask Benchmark Bot for a run.',
    mustAskBefore: 'posting a review; approving, merging, or closing anything.',
    doneWhen: 'every open pull request has a review draft within a day, and nothing is merged without the maintainer.',
    provenance: profileSource,
  },
  docs: {
    owns: 'the docs and the examples: keeping them current with each change, and the release notes draft.',
    may: 'read the code and merged pull requests; draft docs, examples, and release notes on a branch.',
    mustAskBefore: 'publishing docs; changing a public example\'s behavior.',
    doneWhen: 'every merged change has its docs updated on a branch, and the release notes draft lists every change with a link.',
    provenance: profileSource,
  },
  release: {
    owns: 'the release checklist: version tag, changelog, package build, and the announcement draft.',
    may: 'read the merged changes and the benchmark reports; draft the changelog and the announcement; build the package on a branch.',
    mustAskBefore: 'tagging a version; publishing a package; posting an announcement.',
    doneWhen: 'the checklist is complete and every item waits for the maintainer\'s OK.',
    provenance: profileSource,
  },
  community: {
    owns: 'questions in discussions and the forum: a draft answer for each, with a link to the docs or the code.',
    may: 'read discussions, issues, and docs; draft answers; ask Docs Bot when a page is missing.',
    mustAskBefore: 'posting any answer; naming a contributor in public.',
    doneWhen: 'every open question has a draft answer within a day, and nothing is posted without the maintainer.',
    provenance: profileSource,
  },
  research: {
    owns: 'sourced notes on other agent frameworks, protocols, and standards; the comparison table the roadmap works from.',
    may: 'research the web and other repositories (read only); draft notes in the shared folder.',
    mustAskBefore: 'contacting another project; publishing a comparison.',
    doneWhen: 'each note has its sources and a date, and the comparison table is current every Monday.',
    provenance: profileSource,
  },
  benchmark: {
    owns: 'the agent evaluation suite: running it on every candidate build and the report with what got better or worse.',
    may: 'run the suite on branches and previews; draft the report; file a regression as an issue draft.',
    mustAskBefore: 'changing the suite itself; running against a paid model account.',
    doneWhen: 'every candidate build has a report with the numbers and the diff against the last release.',
    provenance: profileSource,
  },
  security: {
    owns: 'dependency and secrets scans on every pull request; the review of risky changes; the pre-release checklist.',
    may: 'read the code, pull requests, and lock files; run the scans; draft fixes as pull requests.',
    mustAskBefore: 'rotating or revoking any credential; changing a dependency\'s version; scanning anything outside the project.',
    doneWhen: 'no secret in the repository, every flagged dependency has a draft fix, and the pre-release checklist passes.',
    provenance: profileSource,
  },
  roadmap: {
    owns: 'the release plan: issues and research notes turned into milestones, each with its owner bot and its done-when.',
    may: 'read issues, notes, and the benchmark reports; draft the plan and the milestones.',
    mustAskBefore: 'adding scope after the plan is approved; promising anything in public.',
    doneWhen: 'the plan is approved and every milestone has an owner, a done-when, and a date.',
    provenance: profileSource,
  },
  books: {
    owns: 'the weekly spend summary: hosting, continuous integration minutes, model credits, and domains, with anything about to renew.',
    may: 'read the billing exports the maintainer shares; draft the summary and the budget.',
    mustAskBefore: 'any purchase, renewal, cancellation, or change to a payment setting.',
    doneWhen: 'the summary is delivered every Friday and nothing renews unwarned.',
    provenance: profileSource,
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
  { id: 'seat-sam', name: 'Sam Rivera', role: 'Maintainer', kind: 'human', reportsTo: null, card: cards.sam },
  { id: 'seat-grok', name: 'Grok Bot', role: 'Manager', kind: 'bot', reportsTo: 'seat-sam', card: cards.grok },
  { id: 'seat-issue-bot', name: 'Issue Bot', role: 'Triages new issues', kind: 'bot', reportsTo: 'seat-grok', card: cards.issues },
  { id: 'seat-review-bot', name: 'Review Bot', role: 'Reviews pull requests', kind: 'bot', reportsTo: 'seat-grok', card: cards.review },
  { id: 'seat-docs-bot', name: 'Docs Bot', role: 'Keeps the docs current', kind: 'bot', reportsTo: 'seat-grok', card: cards.docs },
  { id: 'seat-release-bot', name: 'Release Bot', role: 'Prepares each release', kind: 'bot', reportsTo: 'seat-grok', card: cards.release },
  { id: 'seat-community-bot', name: 'Community Bot', role: 'Drafts answers to questions', kind: 'bot', reportsTo: 'seat-grok', card: cards.community },
  { id: 'seat-research-bot', name: 'Research Bot', role: 'Tracks other agent frameworks', kind: 'bot', reportsTo: 'seat-grok', card: cards.research },
  { id: 'seat-benchmark-bot', name: 'Benchmark Bot', role: 'Runs the agent evaluations', kind: 'bot', reportsTo: 'seat-grok', card: cards.benchmark },
  { id: 'seat-security-bot', name: 'Security Bot', role: 'Scans dependencies and secrets', kind: 'bot', reportsTo: 'seat-grok', card: cards.security },
  { id: 'seat-roadmap-bot', name: 'Roadmap Bot', role: 'Writes the release plan', kind: 'bot', reportsTo: 'seat-grok', card: cards.roadmap },
  { id: 'seat-books-bot', name: 'Bookkeeping Bot', role: 'Sums the weekly spend', kind: 'bot', reportsTo: 'seat-grok', card: cards.books },
]

/**
 * A made-up fortnight of the version 2.0 release, mapped to the seat that did the work. onMain is true when the
 * maintainer approved the step; those are the recorded approvals. The rest are work events.
 */
export const ACTIVITY = [
  { ref: 'release-001', at: '2026-10-01T09:12:00+00:00', summary: 'Release plan: tool calling, streaming, and the new eval suite in 2.0', seatId: 'seat-roadmap-bot', onMain: true },
  { ref: 'release-002', at: '2026-10-02T10:05:00+00:00', summary: 'Triaged twelve new issues: four bugs, five features, three questions', seatId: 'seat-issue-bot', onMain: false },
  { ref: 'release-003', at: '2026-10-03T15:40:00+00:00', summary: 'Reviewed the streaming pull request: tests added, two names changed', seatId: 'seat-review-bot', onMain: false },
  { ref: 'release-004', at: '2026-10-06T11:00:00+00:00', summary: 'Streaming pull request approved and merged', seatId: 'seat-review-bot', onMain: true },
  { ref: 'release-005', at: '2026-10-06T16:30:00+00:00', summary: 'Benchmarks on the candidate: tool calling up, latency unchanged', seatId: 'seat-benchmark-bot', onMain: false },
  { ref: 'release-006', at: '2026-10-07T09:20:00+00:00', summary: 'Dependency scan: one package pinned, no secrets found', seatId: 'seat-security-bot', onMain: false },
  { ref: 'release-007', at: '2026-10-08T10:10:00+00:00', summary: 'Docs updated for streaming, with a runnable example', seatId: 'seat-docs-bot', onMain: false },
  { ref: 'release-008', at: '2026-10-08T14:00:00+00:00', summary: 'Reviewed the tool-calling pull request: one regression sent back', seatId: 'seat-review-bot', onMain: false },
  { ref: 'release-009', at: '2026-10-09T09:15:00+00:00', summary: 'Tool-calling pull request approved and merged', seatId: 'seat-review-bot', onMain: true },
  { ref: 'release-010', at: '2026-10-09T12:30:00+00:00', summary: 'Comparison table: six frameworks, protocol support by column', seatId: 'seat-research-bot', onMain: false },
  { ref: 'release-011', at: '2026-10-09T13:05:00+00:00', summary: 'Drafted answers to five questions in discussions', seatId: 'seat-community-bot', onMain: false },
  { ref: 'release-012', at: '2026-10-10T08:45:00+00:00', summary: 'Release notes draft: every change with its link and its author', seatId: 'seat-docs-bot', onMain: true },
  { ref: 'release-013', at: '2026-10-13T09:00:00+00:00', summary: 'Benchmarks on the release candidate: all suites green', seatId: 'seat-benchmark-bot', onMain: false },
  { ref: 'release-014', at: '2026-10-13T11:20:00+00:00', summary: 'Release checklist: tag, changelog, package build, announcement draft', seatId: 'seat-release-bot', onMain: false },
  { ref: 'release-015', at: '2026-10-14T09:30:00+00:00', summary: 'Version 2.0 tagged and the announcement approved', seatId: 'seat-release-bot', onMain: true },
  { ref: 'release-016', at: '2026-10-14T17:00:00+00:00', summary: 'Weekly spend summary: hosting, CI minutes, one renewal due', seatId: 'seat-books-bot', onMain: false },
] as const

/** Benchmark Bot's recorded run against the first 2.0 patch candidate. Not a step of the release itself. */
export const QA_RUN = {
  at: '2026-10-15T06:05:00+00:00',
  summary: 'Benchmarks on the 2.0.1 candidate: green',
  seatId: 'seat-benchmark-bot',
} as const

export const MILESTONES = [
  'release plan approved',
  'open pull requests reviewed',
  'benchmarks green on the candidate',
  'release notes approved',
  'version 2.0 tagged',
] as const
