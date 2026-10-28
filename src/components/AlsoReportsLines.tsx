import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Seat } from '../data/mock-companies'

type Box = { x: number; y: number; w: number; h: number }

/** A dotted line from the bottom center of the manager card to the top center of the report, in tree coordinates. */
export function alsoLinePath(from: Box, to: Box): string {
  const x1 = from.x + from.w / 2
  const y1 = from.y + from.h
  const x2 = to.x + to.w / 2
  const y2 = to.y
  const mid = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
}

/** Where a card sits inside the tree, before zoom: the tree is zoomed as a whole, and this layer with it. */
function boxIn(tree: HTMLElement, card: HTMLElement): Box | null {
  let x = 0
  let y = 0
  let node: HTMLElement | null = card
  while (node && node !== tree) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  if (node !== tree) return null
  return { x, y, w: card.offsetWidth, h: card.offsetHeight }
}

/** One card's box in the tree, found by its seat. */
function seatBox(tree: HTMLElement, id: string): Box | null {
  const card = tree.querySelector<HTMLElement>(`.org-card-hit[data-seat-id="${id.replace(/["\\]/g, '\\$&')}"]`)
  return card ? boxIn(tree, card) : null
}

/**
 * Draws the lines again in a copy of the chart laid out somewhere else, like the PNG's sheet: the copy is as wide as the
 * whole chart, so its cards are not where they sit on screen. A line whose card is missing is left out.
 */
export function redrawAlsoLines(svg: SVGSVGElement): void {
  const tree = svg.parentElement
  if (!tree) return
  for (const path of [...svg.querySelectorAll('path')]) {
    const a = seatBox(tree, path.dataset.from ?? '')
    const b = seatBox(tree, path.dataset.to ?? '')
    if (a && b) path.setAttribute('d', alsoLinePath(a, b))
    else path.remove()
  }
  svg.setAttribute('width', String(tree.offsetWidth))
  svg.setAttribute('height', String(tree.offsetHeight))
}

/**
 * Extra managers as dotted lines, drawn under the cards inside the tree so pan, zoom, and Download PNG carry them.
 * A line to or from a card that is not on screen (a collapsed branch) is left out.
 */
export function AlsoReportsLines({ treeRef, seats, layoutKey }: { treeRef: RefObject<HTMLUListElement | null>; seats: Seat[]; layoutKey: string }) {
  const [lines, setLines] = useState<{ key: string; from: string; to: string; d: string }[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const pairKey = seats.flatMap((seat) => (seat.alsoReportsTo ?? []).map((manager) => `${manager}>${seat.id}`)).join('|')

  useLayoutEffect(() => {
    const tree = treeRef.current
    if (!tree || !pairKey) return
    const measure = () => {
      const next: { key: string; from: string; to: string; d: string }[] = []
      for (const key of pairKey.split('|')) {
        const [manager = '', report = ''] = key.split('>')
        const a = seatBox(tree, manager)
        const b = seatBox(tree, report)
        if (a && b) next.push({ key, from: manager, to: report, d: alsoLinePath(a, b) })
      }
      setLines(next)
      setSize({ w: tree.offsetWidth, h: tree.offsetHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(tree)
    return () => observer.disconnect()
  }, [treeRef, pairKey, layoutKey])

  if (!pairKey) return null
  return (
    <svg className="org-also-lines" width={size.w} height={size.h} aria-hidden="true">
      {lines.map((line) => <path key={line.key} d={line.d} data-from={line.from} data-to={line.to} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="6 5" />)}
    </svg>
  )
}
