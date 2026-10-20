import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Seat } from '../data/mock-companies'
import { SeatCardCue } from './SeatCardCue'
import { anchoredScroll, fitScale, formatZoom, pickedSeatName } from './org-zoom'
import { Button } from './Button'
import { SeatListDrawer } from './SeatListDrawer'
import { botBlurb, orgCardLabel, taskNote } from './org-card-copy'
import { grokSyncClass, grokSyncTag, legendCounts, legendGroup, LEGEND_TITLES, seatListMeta, type LegendGroup } from './sync-copy'

const ZOOM_MIN = 0.2
const ZOOM_MAX = 1.8

/**
 * Top-down org tree. The viewport scrolls natively (`overflow: auto`).
 * A mouse drag on the background pans it; the drag holds pointer capture, so
 * releasing outside the window ends it. The wheel zooms around the pointer.
 * Zoom is also the segmented control (−, zoom readout, +, Fit) and pinch.
 * Fit scales the whole tree into the viewport and centers it.
 */
export function OrgChart({
  seats,
  selectedId,
  onSelect,
  highlightId = '',
  leastUsedId,
  sampleUsage = false,
  emptyIds = [],
  allowHire = false,
  onHireEmpty,
  workOwners,
  workHref,
  live,
  grokStates = false,
  actions,
  retired,
  legendLists = false,
  focusId = '',
}: {
  seats: Seat[]
  selectedId: string
  onSelect: (id: string) => void
  highlightId?: string
  leastUsedId?: string
  sampleUsage?: boolean
  emptyIds?: readonly string[]
  allowHire?: boolean
  onHireEmpty?: (id: string) => void
  /** Seats that own at least one process step. When set, other seats show No work yet. */
  workOwners?: ReadonlySet<string>
  workHref?: (seatId: string) => string
  live?: ReadonlyMap<string, { running: boolean; reporting: boolean; last: string }>
  /** Color bot cards by whether Grok Bot runs them. Only an org of your own has that information. */
  grokStates?: boolean
  /** Buttons at the start of the toolbar, so they sit in view above the chart. */
  actions?: ReactNode
  /** Retired seats of an org of your own. The legend entry opens the list. */
  retired?: { count: number; onOpen: () => void }
  /** Each legend number opens the seats it counts. Off on templates and samples. */
  legendLists?: boolean
  /** A seat to find once, from the address (`?seat=`), as Find seat does. */
  focusId?: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLUListElement>(null)
  const scaleRef = useRef(1)
  const anchorRef = useRef<{ left: number; top: number } | null>(null)
  const pinchRef = useRef(0)
  const panRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  // The seat Find seat jumped to. A re-fit (the seat panel opening narrows the chart) scrolls back to it, until the person pans or zooms.
  const focusRef = useRef('')
  const [scale, setScale] = useState(1)
  const [panning, setPanning] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [foundId, setFoundId] = useState('')
  const [listed, setListed] = useState<LegendGroup | null>(null)
  const focusedRef = useRef('')

  const forest = useMemo(() => buildForest(seats), [seats])
  const seatNames = useMemo(() => seats.map((seat) => seat.name), [seats])
  const counts = useMemo(() => legendCounts(seats, emptyIds), [seats, emptyIds])
  const reports = useMemo(() => childrenOf(seats), [seats])
  const parents = useMemo(() => parentOf(seats), [seats])
  const layoutKey = seats.map((seat) => seat.id).join('|')

  /** Zooms to `next`, keeping `anchor` (viewport-relative) still. Without an anchor the viewport center stays still. */
  function applyScale(next: number, anchor?: { x: number; y: number }) {
    const viewport = viewportRef.current
    const clamped = clamp(next, ZOOM_MIN, ZOOM_MAX)
    focusRef.current = ''
    if (viewport && scaleRef.current > 0) {
      const point = anchor ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }
      anchorRef.current = anchoredScroll(viewport, point, clamped / scaleRef.current)
    }
    scaleRef.current = clamped
    setScale(clamped)
  }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest('button, a, input, select, textarea, [role="tab"]')) return
    const viewport = viewportRef.current
    if (!viewport) return
    focusRef.current = ''
    panRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }
    viewport.setPointerCapture(event.pointerId)
    setPanning(true)
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    const viewport = viewportRef.current
    if (!pan || !viewport || event.pointerId !== pan.id) return
    viewport.scrollLeft = pan.left - (event.clientX - pan.x)
    viewport.scrollTop = pan.top - (event.clientY - pan.y)
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    if (!pan || event.pointerId !== pan.id) return
    panRef.current = null
    setPanning(false)
    const viewport = viewportRef.current
    if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
  }

  function fit() {
    const viewport = viewportRef.current
    const tree = treeRef.current
    if (!viewport || !tree) return
    const previousZoom = tree.style.zoom
    const previousVar = tree.style.getPropertyValue('--org-zoom')
    writeTreeZoom(tree, 1)
    const width = Math.max(tree.scrollWidth, tree.offsetWidth)
    const height = Math.max(tree.scrollHeight, tree.offsetHeight)
    tree.style.zoom = previousZoom
    if (previousVar) tree.style.setProperty('--org-zoom', previousVar)
    else tree.style.removeProperty('--org-zoom')
    if (!width || !height) return
    const availableW = Math.max(viewport.clientWidth - 48, 160)
    const availableH = Math.max(viewport.clientHeight - 32, 160)
    const raw = Math.min(availableW / width, availableH / height, 1)
    const next = fitScale(raw)
    const fits = width * next <= viewport.clientWidth && height * next <= viewport.clientHeight
    // A chart wider than the screen opens centred, where the top seat is, not at its left edge.
    const left = Math.max(0, (width * next - viewport.clientWidth) / 2)
    const top = fits ? Math.max(0, (height * next - viewport.clientHeight) / 2) : 0
    anchorRef.current = { left, top }
    if (Math.abs(next - scaleRef.current) < 0.01) {
      viewport.scrollLeft = left
      viewport.scrollTop = top
      scrollToFocus()
      return
    }
    scaleRef.current = next
    setScale(next)
  }

  useLayoutEffect(() => {
    if (treeRef.current) writeTreeZoom(treeRef.current, scale)
    const viewport = viewportRef.current
    const anchor = anchorRef.current
    if (!viewport || !anchor) return
    viewport.scrollLeft = anchor.left
    viewport.scrollTop = anchor.top
    anchorRef.current = null
    scrollToFocus()
  }, [scale])

  useLayoutEffect(() => {
    fit()
    const frame = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(frame)
  }, [layoutKey, collapsed])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onResize = () => fit()
    const observer = new ResizeObserver(onResize)
    // Border box: scrollbars appearing or vanishing as the zoom changes must not count as a resize.
    observer.observe(viewport, { box: 'border-box' })
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [layoutKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08
      const rect = viewport.getBoundingClientRect()
      applyScale(scaleRef.current * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) pinchRef.current = touchDistance(event)
    }
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !pinchRef.current) return
      event.preventDefault()
      const next = touchDistance(event)
      const factor = next / pinchRef.current
      pinchRef.current = next
      applyScale(scaleRef.current * factor)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    viewport.addEventListener('touchstart', onTouchStart, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
    }
  }, [layoutKey])

  function scrollToFocus() {
    const id = focusRef.current
    if (!id) return
    document.querySelector(`[data-seat-id="${cssEscape(id)}"]`)?.scrollIntoView({ block: 'center', inline: 'center' })
  }

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function jump(raw: string) {
    const q = raw.trim().toLowerCase()
    if (!q) return
    const match =
      seats.find((seat) => seat.name.toLowerCase() === q) ??
      seats.find((seat) => seat.name.toLowerCase().includes(q))
    if (match) focusOn(match)
  }

  /** Opens every manager above the seat, selects it, and keeps it in view through the re-fit its panel causes. */
  function focusOn(match: Seat) {
    const open = new Set<string>()
    let parent = parents.get(match.id)
    while (parent) {
      open.add(parent)
      parent = parents.get(parent)
    }
    setCollapsed((current) => {
      const next = new Set(current)
      for (const id of open) next.delete(id)
      return next
    })
    setFoundId(match.id)
    // The browser's list only offers names matching the box, so an emptied box offers every seat for the next pick.
    setQuery('')
    focusRef.current = match.id
    onSelect(match.id)
    window.setTimeout(scrollToFocus, 40)
  }

  const shownCollapsed = useMemo(() => {
    if (!highlightId) return collapsed
    const next = new Set(collapsed)
    let parent = parents.get(highlightId)
    while (parent) {
      next.delete(parent)
      parent = parents.get(parent)
    }
    return next
  }, [collapsed, highlightId, parents])

  useEffect(() => {
    if (!highlightId) return
    const timer = window.setTimeout(() => {
      document.querySelector(`[data-seat-id="${cssEscape(highlightId)}"]`)?.scrollIntoView({
        block: 'center',
        inline: 'center',
      })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [highlightId])

  /** A legend number, as a button that lists its seats when the lists are on. */
  function legendItem(group: LegendGroup, swatch: string, label: string, count: number) {
    const body = <><i className={`swatch ${swatch}`} /> {label} <span className="legend-count">{count}</span></>
    if (!legendLists) return <li>{body}</li>
    return (
      <li>
        <Button variant="ghost" type="button" className="legend-button" disabled={count === 0} onClick={() => setListed(group)}>{body}</Button>
      </li>
    )
  }

  const listedSeats = listed ? legendGroup(seats, listed, emptyIds) : []

  useEffect(() => {
    if (!focusId || focusedRef.current === focusId) return
    const match = seats.find((seat) => seat.id === focusId)
    if (!match) return
    focusedRef.current = focusId
    focusOn(match)
    // focusOn reads the chart as drawn now; it runs once per address.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, seats])

  const solo = seats.length <= 1
  return (
    <div className={solo ? 'org-chart is-solo' : 'org-chart'} data-testid="org-chart" data-highlight={highlightId || undefined}>
      <div
        ref={viewportRef}
        className={panning ? 'org-viewport is-panning' : 'org-viewport'}
        data-testid="org-canvas"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
      >
        <ul ref={treeRef} className="org-tree" role="tree" aria-label="Org chart">
          {forest.map((seat) => (
            <OrgBranch
              key={seat.id}
              seat={seat}
              childrenOf={reports}
              collapsed={shownCollapsed}
              selectedId={selectedId}
              foundId={foundId}
              highlightId={highlightId}
              onSelect={onSelect}
              onToggle={toggle}
              leastUsedId={leastUsedId}
              sampleUsage={sampleUsage}
              emptyIds={emptyIds}
              allowHire={allowHire}
              onHireEmpty={onHireEmpty}
              workOwners={workOwners}
              workHref={workHref}
              live={live}
              grokStates={grokStates}
            />
          ))}
        </ul>
      </div>
      <div className="org-toolbar" role="toolbar" aria-label="Org chart view">
        <form
          className="org-find"
          onSubmit={(event) => {
            event.preventDefault()
            jump(query)
          }}
        >
          <label className="sr-only" htmlFor="find-seat">Find seat</label>
          <input
            id="find-seat"
            list="org-seat-names"
            value={query}
            placeholder="Find seat"
            onChange={(event) => {
              setQuery(event.target.value)
              if (pickedSeatName((event.nativeEvent as InputEvent).inputType, event.target.value, seatNames)) jump(event.target.value)
            }}
          />
          <datalist id="org-seat-names">
            {seats.map((seat) => (
              <option key={seat.id} value={seat.name} />
            ))}
          </datalist>
        </form>
        <div className="org-zoom" role="group" aria-label="Zoom">
          <Button variant="secondary" type="button" onClick={() => applyScale(scaleRef.current / 1.15)} aria-label="Zoom out">
            −
          </Button>
          <Button variant="secondary" type="button" onClick={() => applyScale(1)}>
            {formatZoom(scale)}
          </Button>
          <Button variant="secondary" type="button" onClick={() => applyScale(scaleRef.current * 1.15)} aria-label="Zoom in">
            +
          </Button>
          <Button variant="secondary" type="button" onClick={fit}>
            Fit
          </Button>
        </div>
      </div>
      {actions ? <div className="org-actions">{actions}</div> : null}
      <ul className="org-legend">
        {legendItem('human', 'swatch-human', 'Human', counts.human)}
        {legendItem('bot', 'swatch-bot', 'Bot', counts.bot)}
        {legendItem('system', 'swatch-system', 'System', counts.system)}
        {grokStates ? (
          <>
            {legendItem('in-grok', 'swatch-grok', 'In Grok Bot', counts.inGrok)}
            {legendItem('off-grok', 'swatch-off-grok', 'Not in Grok Bot', counts.offGrok)}
          </>
        ) : null}
        {retired ? (
          <li>
            <Button variant="ghost" type="button" className="legend-button legend-retired" disabled={retired.count === 0} onClick={retired.onOpen}>
              <i className="swatch swatch-retired" /> Retired <span className="legend-count">{retired.count}</span>
            </Button>
          </li>
        ) : null}
      </ul>
      {listed ? (
        <SeatListDrawer
          title={LEGEND_TITLES[listed]}
          rows={listedSeats.map((seat) => ({
            id: seat.id,
            name: seat.name,
            meta: seatListMeta(seat.role, seat.name, seat.reportsTo ? seats.find((item) => item.id === seat.reportsTo)?.name ?? seat.reportsTo : ''),
            tag: grokStates && seat.type === 'bot' ? grokSyncTag(seat) : undefined,
          }))}
          onPick={(id) => {
            setListed(null)
            const seat = seats.find((item) => item.id === id)
            if (seat) focusOn(seat)
          }}
          onClose={() => setListed(null)}
        />
      ) : null}
    </div>
  )
}

function OrgBranch({
  seat,
  childrenOf,
  collapsed,
  selectedId,
  foundId,
  highlightId = '',
  onSelect,
  onToggle,
  leastUsedId,
  sampleUsage,
  emptyIds = [],
  allowHire = false,
  onHireEmpty,
  workOwners,
  workHref,
  live,
  grokStates = false,
}: {
  seat: Seat
  childrenOf: Map<string, Seat[]>
  collapsed: Set<string>
  selectedId: string
  foundId: string
  highlightId?: string
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  leastUsedId?: string
  sampleUsage: boolean
  emptyIds?: readonly string[]
  allowHire?: boolean
  onHireEmpty?: (id: string) => void
  workOwners?: ReadonlySet<string>
  workHref?: (seatId: string) => string
  live?: ReadonlyMap<string, { running: boolean; reporting: boolean; last: string }>
  grokStates?: boolean
}) {
  const empty = emptyIds.includes(seat.id)
  const reports = childrenOf.get(seat.id) ?? []
  const isCollapsed = collapsed.has(seat.id)
  const seatLive = live?.get(seat.id)
  const sync = grokStates && seat.type === 'bot' && !empty
    ? { tag: grokSyncTag(seat), className: grokSyncClass(seat) === 'is-off-grok' ? 'is-missing' : grokSyncClass(seat) }
    : null
  const classes = [
    selectedId === seat.id ? 'sel' : '',
    foundId === seat.id ? 'found' : '',
    highlightId === seat.id ? 'is-hired' : '',
    seatLive?.running ? 'is-live' : '',
    sync ? grokSyncClass(seat) : '',
    `org-kind-${seat.type}`,
  ]
    .filter(Boolean)
    .join(' ')
  const itemClass = seatLive?.reporting ? 'is-reporting' : ''
  return (
    <li className={itemClass || undefined} role="treeitem" aria-expanded={reports.length ? !isCollapsed : undefined}>
      <div className="org-node">
        {empty ? (
          <div className={`org-card-hit is-empty ${classes}`} data-seat-id={seat.id}>
            <OrgCardFace seat={seat} leastUsedId={leastUsedId} sampleUsage={sampleUsage} last={seatLive?.last} sync={sync} />
          </div>
        ) : (
          <button
            type="button"
            className={`org-card-hit ${classes}`}
            data-seat-id={seat.id}
            aria-pressed={selectedId === seat.id}
            aria-label={orgCardLabel(seat)}
            onClick={() => onSelect(seat.id)}
          >
            <OrgCardFace seat={seat} leastUsedId={leastUsedId} sampleUsage={sampleUsage} last={seatLive?.last} sync={sync} />
          </button>
        )}
        {empty ? <SeatCardCue hire={allowHire} onHire={() => onHireEmpty?.(seat.id)} /> : null}
        {!empty && workOwners && !workOwners.has(seat.id) ? <p className="org-idle">No work yet</p> : null}
        {!empty && workHref && workOwners?.has(seat.id) ? <a className="org-work-link" href={workHref(seat.id)}>See its work</a> : null}
        {reports.length ? (
          <button
            type="button"
            className="org-toggle"
            aria-label={isCollapsed ? `Expand ${seat.name}` : `Collapse ${seat.name}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(seat.id)}
          >
            {isCollapsed ? '+' : '−'}
          </button>
        ) : null}
      </div>
      {reports.length && !isCollapsed ? (
        <ul>
          {reports.map((child) => (
            <OrgBranch
              key={child.id}
              seat={child}
              childrenOf={childrenOf}
              collapsed={collapsed}
              selectedId={selectedId}
              foundId={foundId}
              highlightId={highlightId}
              onSelect={onSelect}
              onToggle={onToggle}
              leastUsedId={leastUsedId}
              sampleUsage={sampleUsage}
              emptyIds={emptyIds}
              allowHire={allowHire}
              onHireEmpty={onHireEmpty}
              workOwners={workOwners}
              workHref={workHref}
              live={live}
              grokStates={grokStates}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function OrgCardFace({
  seat,
  leastUsedId,
  sampleUsage,
  last = '',
  sync = null,
}: {
  seat: Seat
  leastUsedId?: string
  sampleUsage: boolean
  last?: string
  /** Grok Bot state tag for a bot card, when the chart shows those states. */
  sync?: { tag: string; className: string } | null
}) {
  const blurb = seat.type === 'bot' ? botBlurb(seat) : ''
  return (
    <>
      {seat.type === 'bot' ? <span className="org-bot-tag">BOT</span> : (
        <span className={seat.type === 'human' ? 'org-avatar org-avatar-human' : 'org-avatar org-avatar-system'} aria-hidden="true">
          {seat.type === 'human' ? initials(seat.name) : 'SYS'}
        </span>
      )}
      <span className="org-card-text">
        <span className="org-name" title={seat.name}>{seat.name}</span>
        {sync?.tag ? <span className={`org-sync-tag ${sync.className}`}>{sync.tag}</span> : null}
        {seat.type === 'bot' ? (
          <>
            <span className="org-blurb" title={blurb}>{blurb}</span>
            <span className="org-tasks">{taskNote(seat, leastUsedId, sampleUsage)}</span>
            {last ? <span className="org-last">{last}</span> : null}
          </>
        ) : (
          <>
            <span className="org-role" title={seat.role}>
              {seat.role}
              {seat.id === leastUsedId ? ' · Least used' : ''}
            </span>
            {last ? <span className="org-last">{last}</span> : null}
          </>
        )}
      </span>
    </>
  )
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

function childrenOf(seats: Seat[]): Map<string, Seat[]> {
  const known = new Set(seats.map((seat) => seat.id))
  const map = new Map<string, Seat[]>()
  for (const seat of seats) {
    if (!seat.reportsTo || !known.has(seat.reportsTo)) continue
    const list = map.get(seat.reportsTo) ?? []
    list.push(seat)
    map.set(seat.reportsTo, list)
  }
  return map
}

function parentOf(seats: Seat[]): Map<string, string> {
  const known = new Set(seats.map((seat) => seat.id))
  const map = new Map<string, string>()
  for (const seat of seats) {
    if (seat.reportsTo && known.has(seat.reportsTo)) map.set(seat.id, seat.reportsTo)
  }
  return map
}

function buildForest(seats: Seat[]): Seat[] {
  const known = new Set(seats.map((seat) => seat.id))
  return seats.filter((seat) => !seat.reportsTo || !known.has(seat.reportsTo))
}

function touchDistance(event: TouchEvent): number {
  const [a, b] = [event.touches[0], event.touches[1]]
  if (!a || !b) return 0
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Text floors stop at the fit floor. Zoomed out past it, cards shrink whole instead of text outgrowing them. */
function writeTreeZoom(tree: HTMLElement, zoom: number) {
  tree.style.zoom = String(zoom)
  tree.style.setProperty('--org-zoom', String(Math.max(zoom, fitScale(0))))
}
