/** Org cards use 14px text. Fit must not take that below the 12px floor. */
export const ORG_CARD_TEXT_PX = 14
export const ORG_TEXT_FLOOR_PX = 12

/** BOT/SYS tags and initials. Spec §10: painted size stays at least 11px. */
export const ORG_TAG_PX = 12
export const ORG_TAG_FLOOR_PX = 11

export function fitScale(raw: number): number {
  const floor = ORG_TEXT_FLOOR_PX / ORG_CARD_TEXT_PX
  return Math.min(1, Math.max(floor, raw))
}

/** Specified font size so `zoom` still paints at or above `floorPx`. */
export function flooredFontPx(basePx: number, floorPx: number, zoom: number): number {
  if (!(zoom > 0)) return basePx
  return Math.max(basePx, floorPx / zoom)
}

export function effectiveFontPx(basePx: number, floorPx: number, zoom: number): number {
  return flooredFontPx(basePx, floorPx, zoom) * zoom
}

/**
 * Scroll position that keeps the content under `point` (viewport-relative) in place
 * when the zoom changes by `ratio`.
 */
export function anchoredScroll(viewport: { scrollLeft: number; scrollTop: number }, point: { x: number; y: number }, ratio: number): { left: number; top: number } {
  return {
    left: (viewport.scrollLeft + point.x) * ratio - point.x,
    top: (viewport.scrollTop + point.y) * ratio - point.y,
  }
}

/** Zoom control label. 85.7% (0.857, the 12/14 fit floor) rounds to 86%. */
export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`
}
