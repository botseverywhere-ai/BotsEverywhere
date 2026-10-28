import type { OrgTab } from '../routing'
import { WORK_CHART_LOCKED } from '../org/work-chart-lock'

const TABS: { tab: OrgTab; label: string; own?: true }[] = [
  { tab: 'overview', label: 'Organization Overview' },
  { tab: 'connect-bots', label: 'Connect bots', own: true },
  { tab: 'org-chart', label: 'Org Chart' },
  { tab: 'work-chart', label: 'Work Chart' },
  { tab: 'performance', label: 'Performance' },
  { tab: 'logs', label: 'Logs' },
  { tab: 'backup', label: 'Backup', own: true },
]

function orgTabHref(slug: string, tab: OrgTab, template: boolean): string {
  return template ? `#/template/${slug}/${tab}` : `#/org/${slug}/${tab}`
}

export function OrgTabs({ slug, current, template, workChartLocked = false }: { slug: string; current: OrgTab; template: boolean; workChartLocked?: boolean }) {
  return (
    <nav className="org-tabs" aria-label="Org">
      {TABS.filter((item) => !(template && item.own)).map((item) => (
        item.tab === 'work-chart' && workChartLocked ? (
          <span key={item.tab} className="is-locked" aria-disabled="true" tabIndex={0} data-tip={WORK_CHART_LOCKED}>{item.label}<span className="sr-only">: {WORK_CHART_LOCKED}</span></span>
        ) : (
          <a key={item.tab} href={orgTabHref(slug, item.tab, template)} aria-current={item.tab === current ? 'page' : undefined}>
            {item.label}
          </a>
        )
      ))}
    </nav>
  )
}
