import { lazy, Suspense, useEffect, useState } from 'react'
import { AccountMenu } from './components/AccountMenu'
import { Logo } from './components/Logo'
import { Landing } from './pages/Landing'
import { LiveTeam } from './pages/LiveTeam'
import { IntakePage } from './pages/IntakePage'
import { SignIn } from './pages/SignIn'
import { TeamsPage } from './pages/TeamsPage'
import { InvitePage } from './pages/InvitePage'
import { ShareTeam } from './pages/ShareTeam'
import { CreateOrganization } from './pages/CreateOrganization'
import { OwnerDashboard } from './pages/OwnerDashboard'
import { OrgPicker } from './pages/OrgPicker'
import { DemoBanner } from './components/DemoBanner'
import { AppFooter } from './components/AppFooter'
import { SiteNav } from './components/SiteNav'
import { templateBundle, userOrg } from './org/load'
import type { OrgBundle } from '../server/src/org-files.ts'

const DocsPage = lazy(() => import('./pages/DocsPage').then((mod) => ({ default: mod.DocsPage })))
const DemoHome = lazy(() => import('./pages/DemoHome').then((mod) => ({ default: mod.DemoHome })))
const Workspace = lazy(() => import('./pages/Workspace').then((mod) => ({ default: mod.Workspace })))
const SampleCompany = lazy(() => import('./pages/SampleCompany').then((mod) => ({ default: mod.SampleCompany })))
import { APP_MODE } from './mode'
import { showsShowcaseNotice } from './content/showcase-notice'
import { parseHash, titleFor, type AppRoute, type OrgTab } from './routing'
import type { SampleChart } from './data/mock-companies'
import { useSession } from './sessionContext'
import { Button } from './components/Button'
import { NoticeStack } from './components/NoticeStack'
import { ScreenNotice } from './components/ScreenNotice'

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash)
  const route = parseHash(hash)

  useEffect(() => {
    const sync = () => setHash(window.location.hash)
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  const { authEnabled, loading } = useSession()

  useEffect(() => {
    if (loading || authEnabled) return
    if (parseHash(hash).view === 'signin') {
      window.location.hash = APP_MODE === 'sqlite' ? 'teams' : APP_MODE === 'showcase' ? 'how' : 'work'
    }
  }, [loading, authEnabled, hash])

  useEffect(() => {
    const current = parseHash(hash)
    document.title = titleFor(current)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (current.view === 'landing' && current.anchor) {
      const anchor = current.anchor
      const timer = window.setTimeout(() => {
        document.getElementById(anchor)?.scrollIntoView({
          behavior: reduce ? 'auto' : 'smooth',
          block: 'start',
        })
      }, 30)
      return () => window.clearTimeout(timer)
    }
    window.scrollTo({ top: 0, left: 0 })
    document.getElementById('main')?.scrollTo?.({ top: 0 })
  }, [hash])

  return (
    <>
      <ScreenNotice />
      {route.view === 'landing' ? <Landing /> : <AppShell route={route} />}
    </>
  )
}

function AppShell({
  route,
}: {
  route: Exclude<AppRoute, { view: 'landing'; anchor?: string }>
}) {
  const { user, activeTeamId, authEnabled, loading } = useSession()
  const team =
    route.view === 'org' ||
    route.view === 'work' ||
    route.view === 'seat' ||
    route.view === 'share' ||
    route.view === 'sample'
  const privateChart = (route.view === 'org' || route.view === 'work') && activeTeamId !== '' && activeTeamId !== 'sample'
  const liveTeam = (route.view === 'org' || route.view === 'work') && Boolean(user) && activeTeamId !== '' && activeTeamId !== 'sample'
  return (
    <div className={team ? 'team-shell' : 'product-shell'}>
      {route.view === 'share' || route.view === 'owner' || route.view === 'organization' || privateChart ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : null}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {APP_MODE === 'showcase' && !showsShowcaseNotice(APP_MODE, showcasePage(route)) ? <DemoBanner /> : null}
      {APP_MODE !== 'sqlite' && isFileWorkspace(route) ? null : team ? <TeamHeader /> : <ProductHeader />}
      <Suspense fallback={<RouteFallback />}>
      {route.view === 'home' ? <DemoHome /> : null}
      {route.view === 'orgs' ? <OrgPicker /> : null}
      {route.view === 'docs' ? <DocsPage /> : null}
      {APP_MODE === 'sqlite' && route.view === 'intake' ? <IntakePage /> : null}
      {APP_MODE === 'sqlite' && route.view === 'signin' && authEnabled ? <SignIn /> : null}
      {APP_MODE === 'sqlite' && route.view === 'signin' && !authEnabled && loading ? <main id="main" className="app-main"><p className="auth-note">Loading…</p></main> : null}
      {APP_MODE === 'sqlite' && route.view === 'teams' ? <TeamsPage /> : null}
      {APP_MODE === 'sqlite' && route.view === 'organization' ? <CreateOrganization /> : null}
      {APP_MODE === 'sqlite' && route.view === 'owner' ? <OwnerDashboard token={route.token} /> : null}
      {APP_MODE === 'sqlite' && route.view === 'invite' ? <InvitePage token={route.token} /> : null}
      {APP_MODE === 'sqlite' && route.view === 'share' ? <ShareTeam token={route.token} chart={route.chart} /> : null}
      {route.view === 'invalid' ? (
        <main id="main" className="app-main">
          <div className="card auth-card">
            <h1>This link is not valid</h1>
            <p className="auth-lead">The address could not be read. Check the link and try again.</p>
          </div>
        </main>
      ) : null}
      {route.view === 'sample' ? <SampleRoute slug={route.slug} chart={route.chart} /> : null}
      {route.view === 'org-area' ? <OrgArea slug={route.slug} tab={route.tab} template={route.template} /> : null}
      {route.view === 'seat' ? <Workspace bundle={templateBundle} view="org" seatId={route.seatId} /> : null}
      {route.view === 'opened' ? <OpenedOrg slug={route.slug} chart={route.chart} /> : null}
      {route.view === 'directory' ? <Workspace bundle={templateBundle} view="directory" directorySlug={route.slug} /> : null}
      {route.view === 'performance' ? <Workspace bundle={templateBundle} view="performance" /> : null}
      {route.view === 'log' ? <Workspace bundle={templateBundle} view="log" /> : null}
      {liveTeam && (route.view === 'org' || route.view === 'work') ? (
        <LiveTeam key={activeTeamId} mode={route.view} />
      ) : null}
      {!liveTeam && (route.view === 'org' || route.view === 'work') ? (
        <Workspace bundle={templateBundle} view={route.view} />
      ) : null}
      </Suspense>
      {APP_MODE === 'sqlite' ? null : <AppFooter variant={publicFooter(route) ? 'public' : 'compact'} />}
      {APP_MODE === 'template' ? <NoticeStack /> : null}
    </div>
  )
}

function publicFooter(route: Exclude<AppRoute, { view: 'landing'; anchor?: string }>): boolean {
  return route.view === 'home' || route.view === 'docs' || route.view === 'directory'
}

function RouteFallback() {
  return (
    <main id="main" className="app-main">
      <p className="auth-note">Loading…</p>
    </main>
  )
}

function showcasePage(route: Exclude<AppRoute, { view: 'landing'; anchor?: string }>): { sample?: boolean; view: string } {
  if (route.view === 'sample') return { sample: true, view: route.chart }
  if (route.view === 'org-area') return { sample: route.template, view: viewForTab(route.tab) }
  if (route.view === 'opened') return { sample: false, view: route.chart }
  if (route.view === 'seat') return { sample: false, view: 'org' }
  return { sample: false, view: route.view }
}

function isFileWorkspace(route: Exclude<AppRoute, { view: 'landing'; anchor?: string }>): boolean {
  return route.view === 'org' || route.view === 'work' || route.view === 'seat' || route.view === 'sample' || route.view === 'directory' || route.view === 'performance' || route.view === 'log' || route.view === 'opened' || route.view === 'org-area'
}

function TeamHeader() {
  return (
    <header className="app-header">
      <Logo />
      <AppNav />
      <div className="hr">
        <AccountMenu context="team" />
      </div>
    </header>
  )
}

function SampleRoute({ slug, chart }: { slug: string; chart: SampleChart }) {
  const sample = useLoadedSample(slug)
  if (sample === undefined) return <RouteFallback />
  if (!sample) return APP_MODE === 'sqlite' ? <SampleCompany slug={slug} chart={chart} /> : <Workspace bundle={templateBundle} view="work" />
  const view = chart === 'org' ? 'org' : chart === 'directory' ? 'directory' : chart === 'performance' ? 'performance' : chart === 'log' || chart === 'activity' || chart === 'history' ? 'log' : 'work'
  return <Workspace key={slug} bundle={sample} view={view} sample />
}

function useLoadedSample(slug: string): OrgBundle | null | undefined {
  const [sample, setSample] = useState<{ slug: string; bundle: OrgBundle | null } | null>(null)
  useEffect(() => {
    if (!slug) return
    let cancel = false
    import('./org/samples').then((mod) => mod.loadFileSample(slug)).then((found) => {
      if (!cancel) setSample({ slug, bundle: found?.bundle ?? null })
    }).catch(() => {
      if (!cancel) setSample({ slug, bundle: null })
    })
    return () => {
      cancel = true
    }
  }, [slug])
  if (!slug) return null
  if (!sample || sample.slug !== slug) return undefined
  return sample.bundle
}

function viewForTab(tab: OrgTab): 'overview' | 'connect' | 'backup' | 'org' | 'work' | 'performance' | 'log' {
  if (tab === 'connect-bots') return 'connect'
  if (tab === 'backup') return 'backup'
  if (tab === 'org-chart') return 'org'
  if (tab === 'work-chart') return 'work'
  if (tab === 'logs') return 'log'
  if (tab === 'performance') return 'performance'
  return 'overview'
}

function OrgArea({ slug, tab, template }: { slug: string; tab: OrgTab; template: boolean }) {
  const fromFiles = !template && APP_MODE === 'template'
  const disk = useDiskOrg(slug, fromFiles)
  const local = template || fromFiles ? undefined : userOrg(slug)
  const loaded = useLoadedSample(template ? slug : '')
  const sample = template ? loaded : undefined
  const [remote, setRemote] = useState<typeof templateBundle | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (local || template || fromFiles) return
    let cancel = false
    fetch(`/api/orgs/${slug}`)
      .then(async (response) => {
        if (cancel) return
        if (!response.ok) {
          setMissing(true)
          return
        }
        setRemote(await response.json())
      })
      .catch(() => {
        if (!cancel) setMissing(true)
      })
    return () => {
      cancel = true
    }
  }, [fromFiles, local, slug, template])
  if (fromFiles) {
    if (!disk.ready) {
      return (
        <main id="main" className="app-main">
          <p>Loading {slug}…</p>
        </main>
      )
    }
    if (disk.error === 'down') return <WriterDown slug={slug} />
    if (!disk.bundle) return <OrgMissing slug={slug} />
    return <Workspace key={`${slug}-${tab}`} bundle={disk.bundle} view={viewForTab(tab)} />
  }
  if (local) return <Workspace key={`${slug}-${tab}`} bundle={local.bundle} view={viewForTab(tab)} sample={template} />
  if (template) {
    if (sample === undefined) return <RouteFallback />
    if (!sample) {
      return (
        <main id="main" className="app-main">
          <h1>That template is not on this computer</h1>
          <p><a href="#/templates">Templates</a></p>
        </main>
      )
    }
    return <Workspace key={`${slug}-${tab}`} bundle={sample} view={viewForTab(tab)} sample />
  }
  if (remote) return <Workspace key={`${slug}-${tab}`} bundle={remote} view={viewForTab(tab)} sample={template} />
  if (!missing) {
    return (
      <main id="main" className="app-main">
        <p>Loading {slug}…</p>
      </main>
    )
  }
  return <OrgMissing slug={slug} />
}

function OpenedOrg({ slug, chart }: { slug: string; chart: 'work' | 'org' | 'directory' | 'performance' | 'log' }) {
  const fromFiles = APP_MODE === 'template'
  const disk = useDiskOrg(slug, fromFiles)
  if (fromFiles) {
    if (!disk.ready) {
      return (
        <main id="main" className="app-main">
          <p>Loading {slug}…</p>
        </main>
      )
    }
    if (disk.error === 'down') return <WriterDown slug={slug} />
    if (!disk.bundle) return <OrgMissing slug={slug} />
    return <Workspace key={slug} bundle={disk.bundle} view={chart} />
  }
  const org = userOrg(slug)
  if (!org) return <OrgMissing slug={slug} />
  return <Workspace key={slug} bundle={org.bundle} view={chart} />
}

function useDiskOrg(slug: string, enabled: boolean) {
  const [state, setState] = useState<{ slug: string; bundle: OrgBundle | null; error: '' | 'missing' | 'down' }>({ slug: '', bundle: null, error: '' })
  useEffect(() => {
    if (!enabled || !slug) return
    let cancel = false
    fetch(`/api/orgs/${slug}`)
      .then(async (response) => {
        if (cancel) return
        if (response.status === 404) {
          setState({ slug, bundle: null, error: 'missing' })
          return
        }
        if (!response.ok) {
          setState({ slug, bundle: null, error: 'down' })
          return
        }
        setState({ slug, bundle: (await response.json()) as OrgBundle, error: '' })
      })
      .catch(() => {
        if (!cancel) setState({ slug, bundle: null, error: 'down' })
      })
    return () => {
      cancel = true
    }
  }, [enabled, slug])
  if (!enabled || state.slug !== slug) return { ready: false as const, bundle: null, error: '' as const }
  return { ready: true as const, bundle: state.bundle, error: state.error }
}

function OrgMissing({ slug }: { slug: string }) {
  return (
    <main id="main" className="app-main">
      <h1>That org is not on this computer</h1>
      <p>Look in orgs/{slug}/ or open your orgs and create one.</p>
      <p><a href="#/orgs">Your orgs</a></p>
    </main>
  )
}

function WriterDown({ slug }: { slug: string }) {
  return (
    <main id="main" className="app-main">
      <h1>The file writer is not running</h1>
      <p>Restart <code>npm run dev</code>. This org is read from <code>orgs/{slug}/</code> on this computer. Nothing is saved until the writer is up.</p>
    </main>
  )
}

function AppNav() {
  if (APP_MODE === 'sqlite') return null
  return <SiteNav />
}

function ProductHeader() {
  return (
    <header className="app-header product">
      <Logo href="/" />
      <AppNav />
      {APP_MODE === 'sqlite' ? (
        <div className="hr">
          <AccountMenu context="product" />
          <Button variant="secondary"  href="#intake">
            Start from intake
          </Button>
        </div>
      ) : null}
    </header>
  )
}
