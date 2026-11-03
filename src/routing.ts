import type { SampleChart } from './data/mock-companies'
import { isSeatId, seats } from './data/seats'
import { SEAT_SLUG } from '../server/src/org-files.ts'

export type LandingAnchor = 'charts' | 'seats' | 'how'

export type AppRoute =
  | { view: 'landing'; anchor?: LandingAnchor }
  | { view: 'home' }
  | { view: 'org' }
  | { view: 'work' }
  | { view: 'seat'; seatId: string }
  | { view: 'invalid' }
  | { view: 'sample'; slug: string; chart: SampleChart }
  | { view: 'docs' }
  | { view: 'directory'; slug: string }
  | { view: 'performance' }
  | { view: 'log' }
  | { view: 'orgs' }
  | { view: 'org-area'; slug: string; tab: OrgTab; template: boolean }
  | { view: 'opened'; slug: string; chart: 'work' | 'org' | 'directory' | 'performance' | 'log' }

export type OrgTab = 'overview' | 'connect-bots' | 'org-chart' | 'work-chart' | 'performance' | 'logs' | 'backup'

const ORG_TABS = new Set<OrgTab>(['overview', 'connect-bots', 'org-chart', 'work-chart', 'performance', 'logs', 'backup'])

export function parseHash(hash: string): AppRoute {
  let raw: string
  try {
    raw = decodeURIComponent(hash.replace(/^#/, '').trim())
  } catch {
    return { view: 'invalid' }
  }
  const queryAt = raw.indexOf('?')
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt)
  if (path === '' || path === 'landing') return { view: 'landing' }
  if (path === 'charts' || path === 'seats' || path === 'how') {
    return { view: 'landing', anchor: path }
  }
  const bare = path.replace(/^\/+/, '')
  const orgArea = /^org\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(overview|connect-bots|org-chart|work-chart|performance|logs|backup)\/?$/.exec(bare)
  if (orgArea && ORG_TABS.has(orgArea[2] as OrgTab)) {
    return { view: 'org-area', slug: orgArea[1]!, tab: orgArea[2] as OrgTab, template: false }
  }
  const templateArea = /^template\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(overview|connect-bots|org-chart|work-chart|performance|logs|backup))?\/?$/.exec(bare)
  if (templateArea) {
    return { view: 'org-area', slug: templateArea[1]!, tab: (templateArea[2] as OrgTab) || 'overview', template: true }
  }
  if (bare === 'templates' || bare === 'demos' || bare === 'home') return { view: 'home' }
  if (bare === 'orgs') return { view: 'orgs' }
  if (bare === 'org' || bare === 'work' || bare === 'docs' || bare === 'performance' || bare === 'log') {
    return { view: bare }
  }
  const opened = /^o\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(work|org|directory|performance|log))?\/?$/.exec(bare)
  if (opened) return { view: 'opened', slug: opened[1]!, chart: (opened[2] ?? 'work') as 'work' | 'org' | 'directory' | 'performance' | 'log' }
  const directoryPath = path.replace(/^\/+/, '')
  if (directoryPath === 'directory') return { view: 'directory', slug: '' }
  if (directoryPath.startsWith('directory/') && SEAT_SLUG.test(directoryPath.slice('directory/'.length))) {
    return { view: 'directory', slug: directoryPath.slice('directory/'.length) }
  }
  if (path === 'seat') return { view: 'seat', seatId: 'you' }
  if (path.startsWith('seat-')) {
    const id = path.slice(5)
    if (SEAT_SLUG.test(id)) return { view: 'seat', seatId: id }
    return { view: 'home' }
  }
  if (bare.startsWith('sample/') && bare.length > 'sample/'.length && !bare.slice('sample/'.length).includes('/')) {
    return { view: 'sample', slug: bare.slice('sample/'.length), chart: sampleChart(raw) }
  }
  return { view: 'home' }
}

function sampleChart(raw: string): SampleChart {
  const view = queryValue(raw, 'view')
  if (view === 'org' || view === 'work' || view === 'activity' || view === 'performance' || view === 'history' || view === 'directory' || view === 'log') return view
  return 'work'
}

function queryValue(raw: string, key: string): string | null {
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : ''
  return new URLSearchParams(query).get(key)
}

export function titleFor(route: AppRoute): string {
  switch (route.view) {
    case 'landing':
      return 'BotsEverywhere'
    case 'home':
      return 'BotsEverywhere — Templates'
    case 'orgs':
      return 'BotsEverywhere — Your orgs'
    case 'org-area':
      return route.template ? 'BotsEverywhere — Template' : 'BotsEverywhere — Your org'
    case 'org':
    case 'work':
      return 'BotsEverywhere — Your team'
    case 'invalid':
      return 'BotsEverywhere — Link not valid'
    case 'sample':
      return 'BotsEverywhere — Sample organization'
    case 'docs':
      return 'BotsEverywhere — Docs'
    case 'directory':
      return 'BotsEverywhere — Bot directory'
    case 'performance':
      return 'BotsEverywhere — Performance'
    case 'log':
      return 'BotsEverywhere — Log'
    case 'opened':
      return 'BotsEverywhere — Your team'
    case 'seat':
      return `BotsEverywhere — ${isSeatId(route.seatId) ? seats[route.seatId].detailName : route.seatId}`
  }
}

export function routeKey(route: AppRoute): string {
  if (route.view === 'landing') return `landing:${route.anchor ?? ''}`
  if (route.view === 'seat') return `seat:${route.seatId}`
  if (route.view === 'sample') return `sample:${route.slug}:${route.chart}`
  if (route.view === 'directory') return `directory:${route.slug}`
  if (route.view === 'opened') return `opened:${route.slug}:${route.chart}`
  if (route.view === 'org-area') return `org-area:${route.template ? 'template' : 'org'}:${route.slug}:${route.tab}`
  return route.view
}
