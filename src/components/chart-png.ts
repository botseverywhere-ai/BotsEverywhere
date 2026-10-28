/** Download PNG on your own org chart and work chart: the BotsEverywhere logo, the organization's name, then the whole chart. */
import { redrawAlsoLines } from './AlsoReportsLines'

export type PngChart = 'org' | 'work'

const CHART_LABEL: Record<PngChart, string> = { org: 'Org Chart', work: 'Work Chart' }

/** Buttons, pickers, and links in a chart. They come out of the copy before it is laid out, so they leave no gap. */
export const PNG_SKIP = '.org-toggle, .org-work-link, .org-idle, .be-hire-link, .process-delete'

/** Space before Download PNG, after the legend, and before Find seat. */
const LEGEND_GAP = 12

/**
 * Whether Download PNG fits after Retired without covering Find seat. The legend floats over the left of the toolbar's
 * row; on phones it sits above the chart instead, and the button joins the Add a seat row.
 */
export function legendHasRoom({ floating, legendRight, buttonWidth, toolbarLeft }: { floating: boolean; legendRight: number; buttonWidth: number; toolbarLeft: number }): boolean {
  return floating && legendRight + LEGEND_GAP + buttonWidth + LEGEND_GAP <= toolbarLeft
}

/** The legend box: 12px between items, 10px padding and a 1px border on each side. */
const LEGEND_ITEM_GAP = 12
const LEGEND_FRAME = 22

/**
 * Whether the floating legend, at its full width, ends before Find seat. When it does not, it sits above the chart, as
 * on phones, instead of running under the toolbar.
 */
export function legendFits({ legendLeft, itemWidths, toolbarLeft }: { legendLeft: number; itemWidths: number[]; toolbarLeft: number }): boolean {
  const width = itemWidths.reduce((sum, item) => sum + item, 0) + LEGEND_ITEM_GAP * Math.max(itemWidths.length - 1, 0) + LEGEND_FRAME
  return legendLeft + width + LEGEND_GAP <= toolbarLeft
}

/** `<organization> org chart.png`. Characters a file name cannot hold are dropped. */
export function pngFileName(orgName: string, chart: PngChart): string {
  const name = orgName.replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim() || 'Organization'
  return `${name} ${chart} chart.png`
}

/**
 * Lays a copy of the chart out on a sheet off screen, under the logo and the organization's name, saves the sheet as a
 * PNG, and removes it. The chart on screen is never touched. The library loads only when someone downloads.
 */
export async function downloadChartPng(chart: HTMLElement, orgName: string, kind: PngChart): Promise<void> {
  const { toPng } = await import('html-to-image')
  const sheet = document.createElement('div')
  sheet.className = 'chart-png-sheet'
  sheet.setAttribute('aria-hidden', 'true')
  const logo = document.createElement('img')
  logo.className = 'chart-png-logo'
  logo.src = '/lockup-ink.svg'
  logo.alt = 'BotsEverywhere'
  const name = document.createElement('p')
  name.className = 'chart-png-org'
  name.textContent = orgName
  const label = document.createElement('p')
  label.className = 'chart-png-kind'
  label.textContent = CHART_LABEL[kind]
  const copy = chart.cloneNode(true) as HTMLElement
  for (const node of copy.querySelectorAll(PNG_SKIP)) node.remove()
  // The selected card, Find seat, and a fresh hire are marks of the screen, not of the chart.
  for (const card of copy.querySelectorAll('.org-card-hit')) card.classList.remove('sel', 'found', 'is-hired')
  // The copy sits in the same page for a moment; ids stay unique.
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id')
  if (kind === 'org') {
    // The screen may be zoomed in or out. The PNG is always 100%.
    copy.style.zoom = '1'
    copy.style.setProperty('--org-zoom', '1')
  }
  sheet.append(logo, name, label, copy)
  document.body.append(sheet)
  // The sheet is as wide as the whole chart, so its cards are not where they sit on screen: the dotted lines follow them.
  if (kind === 'org') for (const svg of copy.querySelectorAll<SVGSVGElement>('.org-also-lines')) redrawAlsoLines(svg)
  try {
    await logo.decode()
    // The sheet is placed off screen to lay it out; the image itself starts at its corner.
    const url = await toPng(sheet, { pixelRatio: 2, style: { position: 'static', left: '0', top: '0' } })
    const link = document.createElement('a')
    link.href = url
    link.download = pngFileName(orgName, kind)
    link.click()
  } finally {
    sheet.remove()
  }
}
