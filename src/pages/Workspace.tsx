import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Logo } from '../components/Logo'
import { OrgMenu } from '../components/OrgMenu'
import { OrgTabs } from '../components/OrgTabs'
import { OrgSwitcher } from '../components/OrgSwitcher'
import { SiteNav } from '../components/SiteNav'
import { CompanyOverview } from './CompanyOverview'
import { OrgChart } from '../components/OrgChart'
import { ProcessChart } from '../components/ProcessChart'
import { formatShortDate, shownBotMetrics } from '../../server/src/bot-metrics.ts'
import { liveSeats } from '../../server/src/run-log.ts'
import { useRunLines } from '../live/use-run-log'
import { remember, remembered, type RememberedStatus } from '../live/connector-memory'
import { SeatDrawer } from '../components/SeatDrawer'
import type { ProfileChanges } from '../components/BotProfile'
import { SaveAlert } from '../components/SaveAlert'
import { saveNotice } from '../components/save-notice'
import { shownSeatTab } from '../components/seat-drawer-tab'
import { HireDrawer, type HireDraft, type HireResult, type OrgChoice } from '../components/HireDrawer'
import { ExistingBotDrawer, type ExistingBotDraft, type ExistingBotResult } from '../components/ExistingBotDrawer'
import { SyncDrawer } from '../components/SyncDrawer'
import { RetiredDrawer } from '../components/RetiredDrawer'
import { ConnectionBar } from '../components/ConnectionBar'
import { rememberOrgFolder } from '../org/folder-path'
import { activeBotCount, botLimitLine, outgoing, overBotLimit, syncButtonLabel, retiredGroups, type ConnectionView } from '../components/sync-copy'
import { managerChoices } from '../org/manager-choices'
import { slugify, type ConnectorInfo, type SyncStatus } from '../../server/src/grok-sync.ts'
import { HIRE_HIGHLIGHT_KEY } from '../content/hiring-guide.ts'
import { isOpenSeatId, openOrgSeats, stepIdFromOpenSeat } from '../org/open-seats'
import { LogPanel } from '../components/LogPanel'
import { Toast } from '../components/Toast'
import { NoticeBanner } from '../components/NoticeStack'
import { OPEN_SYNC_EVENT, pushNotice, runLinesNotice, snapshotNotice, takePendingSync, type NoticeLink } from '../live/notices'
import { ShowcaseNotice } from '../components/ShowcaseNotice'
import { SHOWCASE_NOTICE, showsShowcaseNotice } from '../content/showcase-notice'
import { companyFromBundle } from '../org/company'
import { APP_MODE } from '../mode'
import { companiesChanged } from '../org/company-list'
import { DEFAULT_ORG_SLUG } from '../org/load'
import { parseHash, type OrgTab } from '../routing'
import type { DirectoryEntry } from '../../server/src/directory-entries.ts'
import { Button } from '../components/Button'
import { TabBoundary } from '../components/TabBoundary'
import {
  SEAT_SLUG,
  activeBotCardGaps,
  bundleFromState,
  cardUnchanged,
  serializeSeat,
  type FileActivity,
  type OrgBundle,
  type SeatDocument,
} from '../../server/src/org-files.ts'
import type { ProcessFile } from '../../server/src/processes.ts'

const DirectoryCatalog = lazy(() => import('./DirectoryPage').then((mod) => ({ default: mod.DirectoryPage })))

type OrgView = 'overview' | 'connect' | 'backup' | 'work' | 'org' | 'directory' | 'performance' | 'log'

const SAVING_OFF = 'Saving is off. Restart npm run dev.'

function writerAnswered(status: number): boolean {
  return status === 404 || status === 422
}

export function Workspace({
  bundle,
  view,
  sample = false,
  seatId = '',
  directorySlug = '',
  onLatest,
}: {
  bundle: OrgBundle
  view: OrgView
  sample?: boolean
  seatId?: string
  directorySlug?: string
  /** Gets the org each time it is saved or re-read, so the next tab can open on it. */
  onLatest?: (bundle: OrgBundle) => void
}) {
  const editable = APP_MODE === 'template' && !sample
  const opened = bundleFromState(bundle.id, bundle.org, bundle.seats, bundle.work, bundle.activity)
  const [org, setOrg] = useState(opened.org)
  const [seats, setSeats] = useState(opened.seats)
  const [work, setWork] = useState(opened.work)
  const [activity, setActivity] = useState(opened.activity)
  const [processes, setProcesses] = useState<ProcessFile[]>(bundle.processes ?? [])
  const [processesKnown, setProcessesKnown] = useState(bundle.processes !== undefined)
  const [fallbackProcess, setFallbackProcess] = useState(bundle.fallbackProcess || 'triage')
  const [selected, setSelected] = useState(seatId)
  const [seatTab, setSeatTab] = useState<{ id: string; tab: 'card' | 'performance' | 'profile' }>({ id: '', tab: 'card' })
  const [writer, setWriter] = useState<'unknown' | 'up' | 'down'>(editable ? 'unknown' : 'down')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [hireNotice, setHireNotice] = useState<{ name: string; orgSlug: string } | null>(null)
  const [botNotice, setBotNotice] = useState<{ kind: 'ok' | 'bad'; message: string } | null>(null)
  const [orgChoices, setOrgChoices] = useState<OrgChoice[]>([])
  const [highlightId, setHighlightId] = useState('')
  const [hire, setHire] = useState<{ entry: DirectoryEntry | null; stepId: string } | null>(null)
  const [retireSlug, setRetireSlug] = useState('')
  const [retiring, setRetiring] = useState(false)
  const [reason, setReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [existingBot, setExistingBot] = useState(false)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [retiredOpen, setRetiredOpen] = useState(false)
  const [present, setPresent] = useState(false)
  const [savedFp, setSavedFp] = useState(() => fingerprint(opened))
  // Seats as last saved. A save checks only the cards that changed since.
  const savedSeats = useRef(new Map(opened.seats.map((seat) => [seat.slug, seat])))
  const [leaveHref, setLeaveHref] = useState('')
  const saveTimer = useRef(0)
  const saveGen = useRef(0)
  const cardDraft = useRef<{ slug: string; owns: string[]; may: string[]; mustAskBefore: string[]; doneWhen: string[]; addToGrokBotUrl: string } | null>(null)
  const [cardSave, setCardSave] = useState<{ slug: string; state: 'saving' | 'saved' | 'error'; message: string } | null>(null)
  const live = useMemo(() => bundleFromState(bundle.id, org, seats, work, activity), [activity, bundle.id, org, seats, work])
  const liveRef = useRef(live)
  liveRef.current = live
  const onLatestRef = useRef(onLatest)
  onLatestRef.current = onLatest
  const changes = fingerprint(live) === savedFp ? 0 : 1
  const company = useMemo(() => companyFromBundle(live), [live])
  const byId = useMemo(() => new Map(company.seats.map((seat) => [seat.id, seat])), [company])
  const active = company.seats.filter((seat) => seat.status !== 'retired')
  const openSeats = useMemo(() => openOrgSeats(company.steps, company.seats, company.org.id), [company])
  const bots = active.filter((seat) => seat.type === 'bot')
  const retired = seats.filter((seat) => seat.status === 'retired')
  const chartSeat = selected ? byId.get(selected) ?? null : null
  const workOwners = useMemo(
    () => (processesKnown ? new Set(processes.flatMap((process) => process.steps.map((step) => step.seat).filter(Boolean))) : undefined),
    [processes, processesKnown],
  )
  const focusSeat = seatFromHash()
  const bundledLog = useMemo(() => bundle.runLog ?? [], [bundle.runLog])
  // The connection bar reads the Connector's light view (two small files), so it answers at once and never waits for a sync plan.
  // A tab switch mounts a new page, so it opens on the last state this browser tab saw instead of Checking.
  const [connection, setConnection] = useState<ConnectionView | null>(() => remembered()?.status ?? null)
  const loadConnection = useCallback(async () => {
    if (!editable) return
    try {
      const response = await fetch('/api/connector')
      if (!response.ok) return
      const info = (await response.json()) as ConnectorInfo
      const next: RememberedStatus = { snapshot: null, error: '', project: info }
      setConnection({ ...next, folder: '' })
      remember(info.orgs[0] ?? '', next)
    } catch {
      setConnection({ snapshot: null, error: SAVING_OFF })
    }
  }, [editable])
  // Live events arrive in bursts while the Connector writes, and each status request costs the writer real time:
  // one request at a time per tab, and one more afterwards when events kept coming.
  const syncBusy = useRef(false)
  const syncAgain = useRef(false)
  const loadSync = useCallback(async () => {
    if (!editable) return
    // The writer answers one request at a time, so the light status goes first and the plan waits for its answer.
    const connected = loadConnection()
    if (syncBusy.current) {
      syncAgain.current = true
      return
    }
    const fetchOnce = async () => {
      try {
        const response = await fetch(`/api/orgs/${bundle.id}/sync`)
        const text = await response.text()
        if (response.status === 404) {
          // The org is on screen, so a 404 here means the writer predates the sync routes.
          setSync({ snapshot: null, error: 'The file writer needs a restart. Stop npm run dev and start it again.', plan: null, lastConfirmed: '', folder: '' })
          return
        }
        if (!response.ok || !text.trimStart().startsWith('{')) return
        const next = JSON.parse(text) as SyncStatus
        // Every copy of the app on this port shares browser storage, so the running writer's folder always wins.
        if (next.folder) rememberOrgFolder(bundle.id, next.folder)
        setSync(next)
      } catch {
        setSync({ snapshot: null, error: SAVING_OFF, plan: null, lastConfirmed: '', folder: '' })
      }
    }
    syncBusy.current = true
    try {
      await connected
      do {
        syncAgain.current = false
        await fetchOnce()
      } while (syncAgain.current)
    } finally {
      syncBusy.current = false
    }
  }, [bundle.id, editable, loadConnection])
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the sync status is fetched from the writer
    void loadSync()
  }, [loadSync])
  const onNewLines = useCallback((fresh: Parameters<typeof runLinesNotice>[0]) => {
    const notice = runLinesNotice(fresh, hrefFor(bundle.id, false, 'work'))
    if (notice) pushNotice({ ...notice, live: true })
  }, [bundle.id])
  const runLines = useRunLines(bundle.id, editable, bundledLog, () => { void rereadOrg().catch(() => undefined); void loadSync() }, () => { void loadSync() }, onNewLines)
  const seenSnapshot = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!sync || sync.error) return
    const notice = snapshotNotice(seenSnapshot.current, sync, bundle.id)
    seenSnapshot.current = sync.snapshot?.stamp ?? ''
    if (notice) pushNotice({ ...notice, live: true })
  }, [bundle.id, sync])
  useEffect(() => {
    if (!editable) return
    const open = () => {
      if (!takePendingSync(bundle.id)) return
      setSyncOpen(true)
      void loadSync()
    }
    open()
    window.addEventListener(OPEN_SYNC_EVENT, open)
    return () => window.removeEventListener(OPEN_SYNC_EVENT, open)
  }, [bundle.id, editable, loadSync])
  useEffect(() => {
    if (error) pushNotice({ kind: 'bad', message: error })
  }, [error])
  function tell(notice: { kind: 'ok' | 'bad'; message: string }, link?: NoticeLink, warn = false) {
    setBotNotice(notice)
    const pop = { ...notice, kind: warn ? 'warn' as const : notice.kind }
    pushNotice(notice.kind === 'ok' && link ? { ...pop, link } : pop)
  }
  const orgChartLink: NoticeLink = { label: 'See your org chart', href: hrefFor(bundle.id, false, 'org') }
  const liveMap = useMemo(
    () => liveSeats(runLines, seats.map((seat) => ({ slug: seat.slug, title: seat.title, reportsTo: seat.reportsTo || '' }))),
    [runLines, seats],
  )
  const metricsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof shownBotMetrics>>()
    for (const seat of seats) {
      if (seat.kind !== 'bot') continue
      map.set(seat.slug, shownBotMetrics({
        title: seat.title,
        slug: seat.slug,
        createdAt: seat.createdAt,
        lastActive: seat.lastActive,
        runs30d: seat.runs30d,
        tasksDone30d: seat.tasksDone30d,
        reportedAt: seat.grokSyncedAt,
        log: runLines,
      }))
    }
    return map
  }, [runLines, seats])
  const chartSeats = [...active.map((seat) => (seat.type === 'bot' ? { ...seat, shown: metricsById.get(seat.id) } : seat)), ...openSeats]
  const least = leastUsed(bots.map((seat) => ({
    id: seat.id,
    stats: { usageCount30d: metricsById.get(seat.id)?.usage ?? 0 },
  })))
  // Only a bot being created is connecting; an update goes to a bot Grok Bot already has.
  const createRequests = (sync?.requests ?? []).filter((item) => item.kind !== 'update')

  const applyLoaded = useCallback((loaded: OrgBundle): OrgBundle => {
    const canonical = bundleFromState(bundle.id, loaded.org, loaded.seats, loaded.work, loaded.activity ?? [])
    setOrg(canonical.org)
    setSeats(canonical.seats)
    setWork(canonical.work)
    setActivity(canonical.activity)
    if (loaded.processes) {
      setProcesses(loaded.processes)
      setProcessesKnown(true)
    }
    if (loaded.fallbackProcess) setFallbackProcess(loaded.fallbackProcess)
    setSavedFp(fingerprint(canonical))
    savedSeats.current = new Map(canonical.seats.map((seat) => [seat.slug, seat]))
    onLatestRef.current?.({ ...loaded, ...canonical })
    return canonical
  }, [bundle.id])

  async function rereadOrg() {
    let response: Response
    try {
      response = await fetch(`/api/orgs/${bundle.id}`)
    } catch {
      setWriter('down')
      throw new Error(SAVING_OFF)
    }
    const text = await response.text()
    if (!text.trimStart().startsWith('{') || !response.ok) {
      setWriter(text.trimStart().startsWith('{') && writerAnswered(response.status) ? 'up' : 'down')
      throw new Error('The chart could not be re-read. Reload the page.')
    }
    const next = JSON.parse(text) as OrgBundle
    applyLoaded({ ...next, activity: next.activity ?? [] })
    setWriter('up')
  }

  useEffect(() => {
    if (!editable) return
    let cancelled = false
    fetch(`/api/orgs/${bundle.id}`)
      .then(async (response) => {
        if (cancelled) return
        const text = await response.text()
        if (!text.trimStart().startsWith('{')) {
          setWriter('down')
          return
        }
        if (!response.ok) {
          setWriter(writerAnswered(response.status) ? 'up' : 'down')
          return
        }
        const next = JSON.parse(text) as OrgBundle
        applyLoaded({ ...next, activity: next.activity ?? [] })
        setWriter('up')
        try {
          localStorage.removeItem(unsavedKey(bundle.id))
        } catch {
          // Dropping an old browser draft is optional.
        }
      })
      .catch(() => {
        if (cancelled) return
        setWriter('down')
      })
    return () => {
      cancelled = true
    }
  }, [applyLoaded, bundle, bundle.id, editable])

  useEffect(() => {
    if (view !== 'org') return
    const slug = readHireHighlight(bundle.id)
    if (!slug || !seats.some((seat) => seat.slug === slug)) return
    // oxlint-disable-next-line react/set-state-in-effect -- the hired seat id is stashed in sessionStorage until the org chart is showing that seat
    setHighlightId(slug)
  }, [bundle.id, seats, view])

  useEffect(() => {
    if (!highlightId) return
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(HIRE_HIGHLIGHT_KEY)
      setHighlightId('')
    }, 2800)
    return () => window.clearTimeout(timer)
  }, [highlightId])

  useEffect(() => {
    if (!editable) return
    let cancelled = false
    const probe = () => {
      fetch(`/api/orgs/${bundle.id}`)
        .then(async (response) => {
          if (cancelled) return
          const text = await response.text()
          if (text.trimStart().startsWith('{') && (response.ok || writerAnswered(response.status))) {
            setWriter('up')
            setError((current) => (current === SAVING_OFF ? '' : current))
          } else setWriter('down')
        })
        .catch(() => {
          if (!cancelled) setWriter('down')
        })
    }
    const timer = window.setInterval(probe, 5000)
    window.addEventListener('focus', probe)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', probe)
    }
  }, [bundle.id, editable])

  useEffect(() => {
    if (!editable) return
    const onClick = (event: MouseEvent) => {
      if (changes === 0 || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!(anchor instanceof HTMLAnchorElement)) return
      const href = anchor.getAttribute('href') || ''
      if (!href.startsWith('#') || anchor.target === '_blank') return
      if (staysInOrg(bundle.id, href)) return
      event.preventDefault()
      event.stopPropagation()
      setLeaveHref(href)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [bundle.id, changes, editable])

  useEffect(() => {
    if (!editable || changes === 0) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [changes, editable])

  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      if (event.key === 'p' || event.key === 'P') setPresent((value) => !value)
      if (event.key === 'Escape') setPresent(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const stepNames = useMemo(() => {
    const names = new Map<string, { workstream: string; index: number }>()
    for (const stream of company.workstreams) {
      stream.stepIds.forEach((id, index) => {
        const trigger = company.triggers.find((item) => item.id === stream.triggerId)
        names.set(id, { workstream: trigger?.label || stream.outcome, index: index + 1 })
      })
    }
    return names
  }, [company])

  function requestHire(entry: DirectoryEntry | null, stepId: string) {
    if (APP_MODE === 'showcase') {
      setToast(SHOWCASE_NOTICE)
      return
    }
    setHire({ entry, stepId })
    void fetch('/api/orgs')
      .then(async (response) => {
        if (!response.ok) return
        const body = (await response.json()) as { orgs?: { slug: string; name: string; ok: boolean }[] }
        setOrgChoices((body.orgs ?? []).filter((org) => org.ok).map((org) => ({ slug: org.slug, name: org.name })))
      })
      .catch(() => setOrgChoices([]))
  }

  async function save(next = live, events: FileActivity[] = []): Promise<{ ok: true } | { ok: false; error: string }> {
    setError('')
    if (APP_MODE === 'showcase') {
      setToast(SHOWCASE_NOTICE)
      return { ok: false, error: SHOWCASE_NOTICE }
    }
    if (!editable) return { ok: false, error: SAVING_OFF }
    const cardErrors = next.seats
      .filter((seat) => !cardUnchanged(seat, savedSeats.current.get(seat.slug)))
      .flatMap((seat) => activeBotCardGaps(seat).map((gap) => `${seat.title}: ${gap.label} is empty.`))
    if (cardErrors.length) {
      const message = cardErrors.join(' ')
      setError(message)
      return { ok: false, error: message }
    }
    let response: Response
    try {
      response = await fetch(`/api/orgs/${bundle.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org: next.org, seats: next.seats, work: next.work, activityAppend: events }),
      })
    } catch {
      setWriter('down')
      setError(SAVING_OFF)
      return { ok: false, error: SAVING_OFF }
    }
    let result: { errors?: string[]; error?: string }
    try {
      result = (await response.json()) as { errors?: string[]; error?: string }
    } catch {
      setWriter('down')
      setError(SAVING_OFF)
      return { ok: false, error: SAVING_OFF }
    }
    if (!response.ok) {
      const message = response.status >= 500 ? SAVING_OFF : result.errors?.join(' ') || result.error || 'Could not save the files.'
      if (response.status >= 500) setWriter('down')
      setError(message)
      return { ok: false, error: message }
    }
    const withLog = bundleFromState(bundle.id, next.org, next.seats, next.work, [...next.activity, ...events])
    setOrg(withLog.org)
    setSeats(withLog.seats)
    setWork(withLog.work)
    setActivity(withLog.activity)
    setSavedFp(fingerprint(withLog))
    savedSeats.current = new Map(withLog.seats.map((seat) => [seat.slug, seat]))
    onLatestRef.current?.({ ...bundle, ...withLog, processes, fallbackProcess })
    setWriter('up')
    return { ok: true }
  }

  function queueCardSave(slug: string, card: { owns: string[]; may: string[]; mustAskBefore: string[]; doneWhen: string[] }, url?: string) {
    const seat = liveRef.current.seats.find((item) => item.slug === slug)
    cardDraft.current = {
      slug,
      owns: card.owns,
      may: card.may,
      mustAskBefore: card.mustAskBefore,
      doneWhen: card.doneWhen,
      addToGrokBotUrl: url ?? seat?.addToGrokBotUrl ?? '',
    }
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void flushCardSave()
    }, 400)
  }

  function flushCardSave() {
    window.clearTimeout(saveTimer.current)
    return persistCardSave()
  }

  async function persistCardSave() {
    const draft = cardDraft.current
    if (!draft || !editable) return
    const seat = liveRef.current.seats.find((item) => item.slug === draft.slug)
    if (seat?.kind === 'bot' && seat.status !== 'retired') {
      const missing = activeBotCardGaps({ ...seat, ...draft })
      if (missing[0]) {
        const message = `${seat.title}: ${missing[0].label} is empty.`
        setCardSave({ slug: draft.slug, state: 'error', message: saveNotice(false, message).message })
        return
      }
    }
    const gen = ++saveGen.current
    setCardSave({ slug: draft.slug, state: 'saving', message: 'Saving…' })
    let response: Response
    try {
      response = await fetch(`/api/orgs/${bundle.id}/seats/${draft.slug}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
    } catch {
      if (gen !== saveGen.current) return
      setWriter('down')
      setCardSave({ slug: draft.slug, state: 'error', message: saveNotice(false, SAVING_OFF).message })
      return
    }
    let result: { errors?: string[]; error?: string } = {}
    try {
      result = (await response.json()) as { errors?: string[]; error?: string }
    } catch {
      result = {}
    }
    if (gen !== saveGen.current) return
    if (!response.ok) {
      const message = result.errors?.join(' ') || result.error || 'Could not save the seat card.'
      if (response.status >= 500) setWriter('down')
      setCardSave({ slug: draft.slug, state: 'error', message: saveNotice(false, message).message })
      return
    }
    setWriter('up')
    setCardSave({ slug: draft.slug, state: 'saved', message: 'Saved' })
    setSavedFp(fingerprint(liveRef.current))
    savedSeats.current = new Map(liveRef.current.seats.map((seat) => [seat.slug, seat]))
  }

  async function commitExisting(draft: ExistingBotDraft): Promise<ExistingBotResult> {
    setBotNotice(null)
    let response: Response
    try {
      response = await fetch(`/api/orgs/${bundle.id}/seats/existing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
    } catch {
      setWriter('down')
      return { ok: false, error: SAVING_OFF }
    }
    let body: { slug?: string; errors?: string[]; error?: string }
    try {
      body = (await response.json()) as { slug?: string; errors?: string[]; error?: string }
    } catch {
      setWriter('down')
      return { ok: false, error: SAVING_OFF }
    }
    if (!response.ok) {
      return { ok: false, error: body.errors?.join(' ') || body.error || 'Could not add that bot.' }
    }
    try {
      await rereadOrg()
    } catch (err) {
      setExistingBot(false)
      tell(saveNotice(false, err instanceof Error ? err.message : 'The chart could not be re-read. Reload the page.'))
      return { ok: true }
    }
    setExistingBot(false)
    tell(saveNotice(true, 'Bot added'), orgChartLink)
    if (body.slug) {
      setSelected(body.slug)
      setSeatTab({ id: body.slug, tab: 'card' })
    }
    return { ok: true }
  }

  async function updateInGrok(slug: string, name: string) {
    setBotNotice(null)
    try {
      const response = await fetch(`/api/orgs/${bundle.id}/grok/updates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seat: slug }),
      })
      const text = await response.text()
      if (response.status === 404 && !text.includes('Org not found')) {
        tell(saveNotice(false, 'The file writer needs a restart. Stop npm run dev and start it again.'))
        return
      }
      const body = (text.trimStart().startsWith('{') ? JSON.parse(text) : {}) as { errors?: string[]; error?: string }
      if (!response.ok) {
        tell(saveNotice(false, body.errors?.join(' ') || body.error || 'Could not ask the Connector.'))
        return
      }
      await loadSync()
      tell(saveNotice(true, `Asked the Connector to update ${name} in Grok Bot`))
    } catch {
      setWriter('down')
      tell(saveNotice(false, SAVING_OFF))
    }
  }

  async function createInGrok(slug: string, name: string) {
    setBotNotice(null)
    try {
      const response = await fetch(`/api/orgs/${bundle.id}/grok/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seat: slug }),
      })
      const text = await response.text()
      if (response.status === 404 && !text.includes('Org not found')) {
        tell(saveNotice(false, 'The file writer needs a restart. Stop npm run dev and start it again.'))
        return
      }
      const body = (text.trimStart().startsWith('{') ? JSON.parse(text) : {}) as { errors?: string[]; error?: string }
      if (!response.ok) {
        tell(saveNotice(false, body.errors?.join(' ') || body.error || 'Could not ask the Connector.'))
        return
      }
      await loadSync()
      tell(saveNotice(true, `Asked the Connector to create ${name} in Grok Bot`))
    } catch {
      setWriter('down')
      tell(saveNotice(false, SAVING_OFF))
    }
  }

  async function moveSeat(slug: string, reportsTo: string) {
    setBotNotice(null)
    try {
      const response = await fetch(`/api/orgs/${bundle.id}/seats/${slug}/manager`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportsTo }),
      })
      const body = (await response.json()) as { errors?: string[]; error?: string }
      if (!response.ok) {
        tell(saveNotice(false, body.errors?.join(' ') || body.error || 'Could not move that seat.'))
        return
      }
      await rereadOrg()
      tell(saveNotice(true, 'Seat moved'), orgChartLink)
    } catch {
      setWriter('down')
      tell(saveNotice(false, SAVING_OFF))
    }
  }

  async function saveProfile(slug: string, changes: ProfileChanges) {
    try {
      const response = await fetch(`/api/orgs/${bundle.id}/seats/${slug}/profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const body = (await response.json()) as { errors?: string[]; error?: string }
      if (!response.ok) {
        tell(saveNotice(false, body.errors?.join(' ') || body.error || 'Could not save the profile.'))
        return
      }
      await rereadOrg()
    } catch {
      setWriter('down')
      tell(saveNotice(false, SAVING_OFF))
    }
  }

  async function commitHire(draft: HireDraft): Promise<HireResult> {
    let orgSlug = draft.orgSlug
    if (draft.newOrg) {
      try {
        const response = await fetch('/api/orgs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: draft.newOrg.name, owner: draft.newOrg.owner }),
        })
        const body = (await response.json()) as { slug?: string; errors?: string[]; error?: string }
        if (!response.ok || !body.slug) return { ok: false, error: body.errors?.join(' ') || body.error || 'Could not create that org.' }
        orgSlug = body.slug
      } catch {
        return { ok: false, error: SAVING_OFF }
      }
    }
    if (!orgSlug) return { ok: false, error: 'Pick an org to hire into.' }
    let response: Response
    try {
      response = await fetch(`/api/orgs/${orgSlug}/seats`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          kind: 'bot',
          directorySlug: draft.directoryId,
          reportsTo: draft.reportsTo,
          addToGrokBotUrl: '',
          owns: draft.owns,
          may: draft.may,
          mustAskBefore: draft.mustAskBefore,
          doneWhen: draft.doneWhen,
          stepId: draft.stepId,
        }),
      })
    } catch {
      return { ok: false, error: SAVING_OFF }
    }
    let body: { slug?: string; errors?: string[]; error?: string }
    try {
      body = (await response.json()) as { slug?: string; errors?: string[]; error?: string }
    } catch {
      return { ok: false, error: SAVING_OFF }
    }
    if (!response.ok || !body.slug) return { ok: false, error: body.errors?.join(' ') || body.error || 'Could not hire that bot.' }
    if (orgSlug === bundle.id) {
      try {
        const loaded = await fetch(`/api/orgs/${bundle.id}`)
        if (!loaded.ok) return { ok: false, error: 'The seat was saved, but the chart could not be re-read. Reload the page.' }
        applyLoaded((await loaded.json()) as OrgBundle)
      } catch {
        return { ok: false, error: 'The seat was saved, but the chart could not be re-read. Reload the page.' }
      }
    }
    rememberHire(body.slug, orgSlug)
    setHire(null)
    setHireNotice({ name: draft.name, orgSlug })
    pushNotice({ kind: 'ok', message: `${draft.name} was hired`, link: { label: 'See your org chart', href: hrefFor(orgSlug, false, 'org') } })
    setWriter('up')
    return { ok: true }
  }

  async function copyThisTemplate() {
    setError('')
    try {
      const response = await fetch('/api/orgs/from-template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: bundle.id }),
      })
      const text = await response.text()
      const body = text.trimStart().startsWith('{') ? JSON.parse(text) as { slug?: string; errors?: string[] } : {}
      if (!response.ok || !body.slug) {
        setError(body.errors?.join(' ') || 'Could not copy this template.')
        return
      }
      companiesChanged()
      window.location.hash = `#/org/${body.slug}/overview`
    } catch {
      setError('Saving is off. Restart npm run dev, then use this template.')
    }
  }

  async function retire() {
    const seat = seats.find((item) => item.slug === retireSlug)
    if (!seat || retiring || (seat.kind === 'human' && !otherPerson(seats, seat.slug))) return
    setRetiring(true)
    const retiredAt = new Date().toISOString()
    // Direct reports move up to the retired seat's manager, so none are left under an empty seat.
    const nextSeats = seats.map((item) => {
      if (item.slug === seat.slug) {
        const next = { ...item, status: 'retired' as const, retiredAt }
        next.source = serializeSeat(next)
        return next
      }
      if (item.reportsTo !== seat.slug || item.status === 'retired') return item
      const moved = { ...item, reportsTo: seat.reportsTo }
      moved.source = serializeSeat(moved)
      return moved
    })
    const event: FileActivity = {
      id: `fire-${seat.slug}-${Date.now()}`,
      orgId: bundle.id,
      type: 'fire',
      actorSeatId: seats.find((item) => item.kind === 'human' && item.status !== 'retired' && item.slug !== seat.slug)?.slug || seat.slug,
      actorType: 'human',
      timestamp: retiredAt,
      summary: reason.trim() ? `Retired ${seat.title} · ${reason.trim()}` : `Retired ${seat.title}`,
      subjectSeatId: seat.slug,
    }
    const next = bundleFromState(bundle.id, org, nextSeats, work, activity)
    const saved = await save(next, [event])
    setRetiring(false)
    if (!saved.ok) return
    setSeats(nextSeats)
    setRetireSlug('')
    setReason('')
    setSelected('')
  }

  const soloYou = editable && active.length === 1
  const showcaseHire = APP_MODE === 'showcase'
  return (
    <div className={present ? 'be-app be-present' : 'be-app'}>
      {showsShowcaseNotice(APP_MODE, { sample, view }) ? <ShowcaseNotice mode={APP_MODE} /> : null}
      <header className="be-top">
        <div className="be-top-main">
          <Logo />
          <SiteNav />
        </div>
        {view !== 'directory' ? (
          <div className="org-sub">
            {sample ? (
              <div className="sample-bar">
                <Button variant="ghost" back href="#templates">Back to templates
                </Button>
                <span className="sample-bar-name">Template: {company.org.name}</span>
                {APP_MODE === 'template' ? (
                  <Button variant="primary" className="template-use" type="button"  onClick={() => void copyThisTemplate()}>
                    Use this template
                  </Button>
                ) : null}
              </div>
            ) : null}
            {editable ? <ConnectionBar slug={bundle.id} status={connection} /> : null}
            {APP_MODE === 'template' && !sample ? <OrgSwitcher slug={bundle.id} name={company.org.name} tab={tabForView(view)} /> : null}
            {editable ? <Button variant="secondary" type="button" className="org-sync" onClick={() => { setSyncOpen(true); void loadSync() }}><SyncIcon />{syncButtonLabel(sync?.plan?.writes ?? 0, outgoing(sync?.plan ?? null, sync?.requests ?? [], seats).ready.length)}</Button> : null}
            <OrgTabs slug={bundle.id} current={tabForView(view)} template={sample} />
            {editable && !sample ? <OrgMenu slug={bundle.id} name={company.org.name} /> : null}
          </div>
        ) : null}
      </header>
      {error ? <p className="save-off" role="alert">{error}</p> : null}
      {hireNotice ? (
        <SaveAlert kind="ok">
          {hireNotice.name} was hired <a href={hrefFor(hireNotice.orgSlug, false, 'org')}>See your org chart</a>
          <Button variant="secondary" type="button" onClick={() => setHireNotice(null)}>Close</Button>
        </SaveAlert>
      ) : null}
      {botNotice ? (
        <SaveAlert kind={botNotice.kind}>
          {botNotice.message}
          <Button variant="secondary" type="button" onClick={() => setBotNotice(null)}>Close</Button>
        </SaveAlert>
      ) : null}
      {toast === SHOWCASE_NOTICE ? <Toast message={toast} className="toast-showcase" /> : toast ? (
        <p className="save-banner" role="status">
          {toast}{' '}
          <Button variant="secondary" type="button" onClick={() => setToast('')}>Close</Button>
        </p>
      ) : null}
      {editable ? <NoticeBanner /> : null}
      {adding ? (
        <AddSeatDialog
          seats={seats}
          onClose={() => setAdding(false)}
          onAdd={(seat) => {
            void (async () => {
              try {
                const response = await fetch(`/api/orgs/${bundle.id}/seats`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    name: seat.title,
                    kind: seat.kind,
                    slug: seat.slug,
                    directorySlug: '',
                    reportsTo: seat.reportsTo,
                    addToGrokBotUrl: '',
                    owns: seat.owns,
                    may: seat.may,
                    mustAskBefore: seat.mustAskBefore,
                    doneWhen: seat.doneWhen,
                  }),
                })
                const body = (await response.json()) as { errors?: string[]; error?: string }
                if (!response.ok) {
                  setError(body.errors?.join(' ') || body.error || 'Could not add that seat.')
                  return
                }
                const loaded = await fetch(`/api/orgs/${bundle.id}`)
                if (!loaded.ok) {
                  setError('The seat was saved, but the chart could not be re-read. Reload the page.')
                  return
                }
                applyLoaded((await loaded.json()) as OrgBundle)
                setAdding(false)
                setError('')
                setWriter('up')
              } catch {
                setError(SAVING_OFF)
              }
            })()
          }}
        />
      ) : null}
      <div className={(view === 'org' || view === 'work') && chartSeat ? 'be-body be-with-panel' : 'be-body'}>
        <TabBoundary key={view}>
        <main id="main">
          {view === 'overview' || view === 'connect' || view === 'backup' ? (
            <CompanyOverview
              section={view}
              slug={bundle.id}
              org={org}
              seats={seats}
              editable={editable}
              sample={sample}
              onOrg={setOrg}
              onImported={rereadOrg}
              onAddExisting={() => setExistingBot(true)}
              sync={sync}
              onSyncChanged={loadSync}
              chartHref={hrefFor(bundle.id, sample, 'org')}
            />
          ) : null}
          {view === 'work' ? (
            <ProcessChart
              orgId={bundle.id}
              editable={editable}
              seats={seats}
              processes={processes}
              fallbackProcess={fallbackProcess}
              focusSeat={focusSeat}
              runLines={runLines}
              onSeat={setSelected}
              onReload={rereadOrg}
            />
          ) : null}
          {view === 'org' ? (
            <>
              <OrgChart
                seats={chartSeats}
                selectedId={selected}
                highlightId={highlightId}
                leastUsedId={least?.id}
                emptyIds={openSeats.map((seat) => seat.id)}
                allowHire={(editable && writer === 'up') || showcaseHire}
                onHireEmpty={(id) => {
                  if (!isOpenSeatId(id)) return
                  requestHire(null, stepIdFromOpenSeat(id))
                }}
                onSelect={(id) => {
                  if (isOpenSeatId(id)) return
                  setSelected(id)
                }}
                workOwners={workOwners}
                workHref={(id) => `${hrefFor(bundle.id, sample, 'work')}?seat=${encodeURIComponent(id)}`}
                live={liveMap}
                grokStates={editable}
                legendLists={editable}
                focusId={view === 'org' ? focusSeat : ''}
                account={editable ? sync?.project?.account ?? null : null}
                retired={editable ? { count: retiredGroups(retired).length, onOpen: () => { setRetiredOpen(true); void loadSync() } } : undefined}
                actions={editable ? <SeatActions onAdd={() => setAdding(true)} onExisting={() => setExistingBot(true)} /> : undefined}
              />
              {editable && soloYou ? <p className="be-caption">No bots yet. Import them from <a href={hrefFor(bundle.id, sample, 'connect')}>Connect bots</a>.</p> : null}
              {editable && soloYou ? <div className="be-solo"><p>Your org has one seat: you.</p></div> : null}
              <p className="be-caption">Org chart = who owns capability. Work chart = how work moves.</p>
            </>
          ) : null}
          {view === 'directory' ? (
            <Suspense fallback={<p className="dir-empty">Loading the directory…</p>}>
              <DirectoryCatalog
                slug={directorySlug}
                sample={!editable}
                writer={writer}
                takenSlugs={seats.filter((seat) => seat.status !== 'retired').flatMap((seat) => [seat.slug, seat.directoryId].filter(Boolean))}
                onHire={(entry) => requestHire(entry, '')}
              />
            </Suspense>
          ) : null}
          {view === 'performance' ? (
            <PerformanceTable
              bots={bots.map((seat) => ({ ...seat, shown: metricsById.get(seat.id) }))}
              leastId={least?.id}
              requests={createRequests}
              canRetire={editable && writer === 'up'}
              onRetire={(id) => {
                setRetireSlug(id)
                setReason('')
              }}
            />
          ) : null}
          {view === 'log' ? <LogPanel events={activity} stepNames={stepNames} onStep={() => { window.location.hash = hrefFor(bundle.id, sample, 'work') }} /> : null}
        </main>
        {(view === 'org' || view === 'work') && chartSeat ? (
        <SeatDrawer
          seat={{ ...chartSeat, shown: metricsById.get(chartSeat.id) }}
          reportsTo={chartSeat.reportsTo ? byId.get(chartSeat.reportsTo)?.name : undefined}
          tab={shownSeatTab(chartSeat.id, seatTab)}
          directorySlug={chartSeat.type === 'bot' ? (seats.find((seat) => seat.slug === chartSeat.id)?.directoryId || chartSeat.id) : ''}
          least={least?.id === chartSeat.id}
          fading={false}
          sample={sample}
          allowRetire={editable && writer === 'up'}
          cardSave={cardSave && cardSave.slug === chartSeat.id ? cardSave : null}
          onTab={(tab) => setSeatTab({ id: chartSeat.id, tab })}
          onClose={() => setSelected('')}
          allowRetireHuman={otherPerson(seats, chartSeat.id)}
          onRetire={chartSeat.type === 'bot' || (chartSeat.type === 'human' && otherPerson(seats, chartSeat.id)) ? () => { setRetireSlug(chartSeat.id); setReason('') } : undefined}
          onEditAttempt={showcaseHire ? () => setToast(SHOWCASE_NOTICE) : undefined}
          onCardCommit={editable ? () => { void flushCardSave() } : undefined}
          managers={editable ? managerChoices(seats, chartSeat.id) : undefined}
          onReportsTo={editable ? (slug) => { void moveSeat(chartSeat.id, slug) } : undefined}
          grokRequestedAt={createRequests.find((item) => item.seat === chartSeat.id)?.requestedAt ?? ''}
          grokUpdateAt={sync?.requests?.find((item) => item.seat === chartSeat.id && item.kind === 'update')?.requestedAt ?? ''}
          onUpdateInGrok={editable && chartSeat.type === 'bot' ? () => { void updateInGrok(chartSeat.id, chartSeat.name) } : undefined}
          onCreateInGrok={editable && chartSeat.type === 'bot' ? () => { void createInGrok(chartSeat.id, chartSeat.name) } : undefined}
          onProfile={editable ? (changes) => { void saveProfile(chartSeat.id, changes) } : undefined}
          onCard={editable ? (card) => {
            setSeats((items) => items.map((seat) => {
              if (seat.slug !== chartSeat.id) return seat
              const next = {
                ...seat,
                owns: card.owns,
                may: card.may,
                mustAskBefore: card.mustAskBefore,
                doneWhen: card.doneWhen,
              }
              next.source = serializeSeat(next)
              return next
            }))
            queueCardSave(chartSeat.id, card)
          } : undefined}
        />
        ) : null}
        </TabBoundary>
      </div>
      {hire && APP_MODE !== 'showcase' ? (
        <HireDrawer orgSlug={bundle.id} orgName={org.company.name} orgs={orgChoices} seats={seats} work={work} entry={hire.entry} stepId={hire.stepId} onClose={() => setHire(null)} onHire={commitHire} />
      ) : null}
      {existingBot ? (
        <ExistingBotDrawer orgSlug={bundle.id} seats={seats} onClose={() => setExistingBot(false)} onSave={commitExisting} />
      ) : null}
      {retiredOpen && editable ? (
        <RetiredDrawer
          seats={retired}
          activeElsewhere={sync?.retiredElsewhere ?? {}}
          onClose={() => setRetiredOpen(false)}
        />
      ) : null}
      {syncOpen && editable ? (
        <SyncDrawer
          orgSlug={bundle.id}
          status={sync}
          seats={seats}
          onClose={() => setSyncOpen(false)}
          onRefresh={loadSync}
          onApplied={async (message) => {
            setSyncOpen(false)
            try {
              await rereadOrg()
            } catch {
              // The sync wrote; the next probe re-reads.
            }
            await loadSync()
            tell(saveNotice(true, message), { label: 'See it in Logs', href: hrefFor(bundle.id, false, 'log') }, message.includes('. Skipped '))
          }}
        />
      ) : null}
      {leaveHref ? (
        <div className="be-modal" role="dialog" aria-labelledby="leave-title">
          <h2 id="leave-title">Save changes before leaving?</h2>
          <Button variant="secondary" type="button" onClick={() => {
            setLeaveHref('')
          }}>Cancel</Button>
          <Button variant="secondary" type="button" onClick={() => {
            const href = leaveHref
            setLeaveHref('')
            window.location.hash = href
          }}>Discard</Button>
          <Button variant="secondary" type="button" onClick={() => void (async () => {
            const saved = await save(live)
            if (!saved.ok) return
            const href = leaveHref
            setLeaveHref('')
            window.location.hash = href
          })()}>Save</Button>
        </div>
      ) : null}
      {retireSlug ? (
        <div className="be-modal" role="dialog" aria-labelledby="retire-title">
          <h2 id="retire-title">Retire {seats.find((seat) => seat.slug === retireSlug)?.title}</h2>
          <RetireStats seatId={retireSlug} events={activity} />
          <label>
            Reason (optional)
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <Button variant="secondary" type="button" onClick={() => setRetireSlug('')}>Cancel</Button>
          <Button variant="secondary" type="button" disabled={retiring} onClick={() => void retire()}>{retiring ? 'Retiring…' : 'Retire'}</Button>
        </div>
      ) : null}
    </div>
  )
}

function PerformanceTable({
  bots,
  leastId,
  requests = [],
  canRetire,
  onRetire,
}: {
  bots: { id: string; name: string; shown?: { createdAt: string; lastActive: string; usage: number | null; tasks: number | null } }[]
  leastId?: string
  /** Bots the app asked the Connector to create. Their row says Connecting until the Connector reports them. */
  requests?: { seat: string; requestedAt: string }[]
  canRetire: boolean
  onRetire: (id: string) => void
}) {
  const rows = [...bots].sort((a, b) => (a.shown?.usage ?? 0) - (b.shown?.usage ?? 0) || a.name.localeCompare(b.name))
  if (!rows.length) return <p className="be-empty">No bots hired yet.</p>
  return (
    <>
      <table className="be-performance">
        <thead>
          <tr><th>Bot</th><th>Created</th><th>Times used (30d)</th><th>Automated tasks done (30d)</th><th>Last active</th><th>Action</th></tr>
        </thead>
        <tbody>
          {rows.map((seat) => {
            const waiting = requests.find((item) => item.seat === seat.id)
            return (
              <tr key={seat.id}>
                <td>{seat.name}{seat.id === leastId ? <em className="be-least">Least used</em> : null}</td>
                {waiting ? (
                  <td colSpan={4} className="be-connecting"><i className="be-pulse" aria-hidden="true" />Connecting to Grok Bot… asked {formatShortDate(waiting.requestedAt)}. Its numbers appear after the Connector&apos;s next run.</td>
                ) : (
                  <>
                    <td>{formatShortDate(seat.shown?.createdAt || '')}</td>
                    <td>{seat.shown?.usage === undefined || seat.shown?.usage === null ? '—' : seat.shown.usage}</td>
                    <td>{seat.shown?.tasks === undefined || seat.shown?.tasks === null ? '—' : seat.shown.tasks}</td>
                    <td>{formatShortDate(seat.shown?.lastActive || '')}</td>
                  </>
                )}
                <td>{canRetire ? <Button variant="secondary" type="button" onClick={() => onRetire(seat.id)}>Retire…</Button> : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="be-performance-note">
        Times used counts each time the Connector saw a bot become active, or the chats the bot logged itself. Automated tasks done counts each routine run the Connector saw,
        or the routine steps the bot logged as done. All of it is in the run log. — means nothing yet: the numbers fill in from the Connector&apos;s next reports.
      </p>
    </>
  )
}

function RetireStats({ seatId, events }: { seatId: string; events: FileActivity[] }) {
  const related = events.filter((event) => event.actorSeatId === seatId || event.subjectSeatId === seatId)
  const tasks = related.filter((event) => event.type === 'work').length
  return <p>{related.length} events on file · {tasks} work events. The seat file stays on disk with status retired.</p>
}

function SeatActions({ onAdd, onExisting }: { onAdd: () => void; onExisting: () => void }) {
  return (
    <>
      <Button variant="primary" type="button" onClick={onAdd}>Add a seat</Button>
      <Button variant="secondary" href="#directory">Hire from the directory</Button>
      <Button variant="secondary" type="button" onClick={onExisting}>Add existing bot</Button>
    </>
  )
}

function AddSeatDialog({
  seats,
  onClose,
  onAdd,
}: {
  seats: SeatDocument[]
  onClose: () => void
  onAdd: (seat: SeatDocument) => void
}) {
  const [shortName, setShortName] = useState('')
  // The seat file is named from the short name, so capitals and spaces can be typed as they are.
  const slug = slugify(shortName)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<SeatDocument['kind']>('human')
  const [reportsTo, setReportsTo] = useState(seats.find((seat) => seat.slug === 'you')?.slug ?? seats[0]?.slug ?? '')
  const [error, setError] = useState('')
  return (
    <div className="be-modal" role="dialog" aria-labelledby="add-seat-title">
      <h2 id="add-seat-title">Add a seat</h2>
      {error ? <p className="save-off" role="alert">{error}</p> : null}
      <label>
        Short name
        <input value={shortName} onChange={(event) => setShortName(event.target.value)} />
      </label>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Kind
        <select value={kind} onChange={(event) => setKind(event.target.value as SeatDocument['kind'])}>
          <option value="human">Human</option>
          <option value="bot">Bot</option>
          <option value="system">System</option>
        </select>
      </label>
      {kind === 'bot' ? (
        <p className={overBotLimit(activeBotCount(seats), 1) ? 'save-off' : 'be-caption'}>{botLimitLine(activeBotCount(seats), 1)}</p>
      ) : null}
      <label>
        Reports to
        <select value={reportsTo} onChange={(event) => setReportsTo(event.target.value)}>
          <option value="">Top of the chart</option>
          {seats.filter((seat) => seat.status !== 'retired').map((seat) => (
            <option key={seat.slug} value={seat.slug}>{seat.title}</option>
          ))}
        </select>
      </label>
      <div className="be-modal-actions">
        <Button variant="secondary" type="button"  onClick={onClose}>Cancel</Button>
        <Button variant="primary"
          type="button"
          
          onClick={() => {
            if (!SEAT_SLUG.test(slug)) {
              setError('Type a short name with letters or numbers, like Research or Site Bot.')
              return
            }
            if (seats.some((seat) => seat.slug === slug)) {
              setError(`A seat named ${shortName.trim()} is already here. Pick another short name.`)
              return
            }
            if (!title.trim()) {
              setError('Title is required.')
              return
            }
            const draft: SeatDocument = {
              slug,
              title: title.trim(),
              department: 'general',
              reportsTo,
              addToGrokBotUrl: '',
              hiredAt: '',
              retiredAt: '',
              directoryId: '',
              status: 'active',
              kind,
              role: title.trim(),
              personId: '',
              owns: [`${title.trim()} owns this seat.`],
              may: ['Do the work described on the card.'],
              mustAskBefore: ['Anything that leaves the team.'],
              doneWhen: ['The card is filled in and committed.'],
              source: '',
            }
            draft.source = serializeSeat(draft)
            onAdd(draft)
          }}
        >
          Add seat
        </Button>
      </div>
    </div>
  )
}

function staysInOrg(orgId: string, href: string): boolean {
  const route = parseHash(href)
  if (route.view === 'org-area') return !route.template && route.slug === orgId
  if (route.view === 'opened') return route.slug === orgId
  if (route.view === 'sample') return false
  if (orgId !== DEFAULT_ORG_SLUG) return false
  return route.view === 'work' || route.view === 'org' || route.view === 'performance' || route.view === 'log' || route.view === 'seat'
}

function tabForView(view: OrgView): OrgTab {
  if (view === 'connect') return 'connect-bots'
  if (view === 'backup') return 'backup'
  if (view === 'org') return 'org-chart'
  if (view === 'work') return 'work-chart'
  if (view === 'log') return 'logs'
  if (view === 'performance') return 'performance'
  return 'overview'
}

function rememberHire(slug: string, orgId: string) {
  sessionStorage.setItem(HIRE_HIGHLIGHT_KEY, JSON.stringify({ slug, orgId, at: Date.now() }))
}

function readHireHighlight(orgId: string): string {
  const raw = sessionStorage.getItem(HIRE_HIGHLIGHT_KEY)
  if (!raw) return ''
  try {
    const pending = JSON.parse(raw) as { slug?: string; orgId?: string; at?: number }
    if (!pending.slug || !pending.at || Date.now() - pending.at > 30_000 || (pending.orgId && pending.orgId !== orgId)) {
      if (pending.orgId && pending.orgId !== orgId) return ''
      sessionStorage.removeItem(HIRE_HIGHLIGHT_KEY)
      return ''
    }
    return pending.slug
  } catch {
    sessionStorage.removeItem(HIRE_HIGHLIGHT_KEY)
    return ''
  }
}

function SyncIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 6.5A5 5 0 0 0 4 4.5L3 5.5M3 2.5v3h3M3 9.5a5 5 0 0 0 9 2l1-1M13 13.5v-3h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function hrefFor(id: string, sample: boolean, view: OrgView): string {
  return sample ? `#/template/${id}/${tabForView(view)}` : `#/org/${id}/${tabForView(view)}`
}

function seatFromHash(): string {
  const hash = window.location.hash
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  return new URLSearchParams(query).get('seat') || ''
}

/** A person can be retired only while another active person stays in the org. */
function otherPerson(seats: SeatDocument[], slug: string): boolean {
  return seats.some((seat) => seat.kind === 'human' && seat.status !== 'retired' && seat.slug !== slug)
}

function unsavedKey(slug: string): string {
  return `be-unsaved-org:${slug}`
}

function fingerprint(bundle: OrgBundle): string {
  return JSON.stringify({
    org: bundle.org,
    seats: [...bundle.seats].map((seat) => seat.source).sort(),
    work: bundle.work,
    activity: bundle.activity.length,
  })
}

function leastUsed<T extends { id: string; stats?: { usageCount30d: number } }>(bots: T[]): T | undefined {
  if (!bots.length) return undefined
  const min = Math.min(...bots.map((seat) => seat.stats?.usageCount30d ?? 0))
  const tied = bots.filter((seat) => (seat.stats?.usageCount30d ?? 0) === min)
  return tied.length === 1 ? tied[0] : undefined
}
