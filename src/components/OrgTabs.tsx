import type { OrgTab } from '../routing'

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

export function OrgTabs({ slug, current, template }: { slug: string; current: OrgTab; template: boolean }) {
  return (
    <nav className="org-tabs" aria-label="Org">
      {TABS.filter((item) => !(template && item.own)).map((item) => (
        <a key={item.tab} href={orgTabHref(slug, item.tab, template)} aria-current={item.tab === current ? 'page' : undefined}>
          {item.label}
        </a>
      ))}
    </nav>
  )
}
