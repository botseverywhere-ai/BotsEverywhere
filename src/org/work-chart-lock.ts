import { importLocked } from '../../server/src/bots-file.ts'
import type { SeatDocument } from '../../server/src/org-files.ts'

/** Why the Work Chart is closed: on the tab's hover and on the page. */
export const WORK_CHART_LOCKED = 'Connect bots to open the Work Chart'

/**
 * The Work Chart opens once the organization has bots, the same moment Step 2 of Connect bots says Linked. Before that
 * it has nothing to show and only confuses. A template always has it open.
 */
export function workChartLocked(seats: Pick<SeatDocument, 'kind' | 'title'>[], template: boolean): boolean {
  return !template && !importLocked(seats)
}
