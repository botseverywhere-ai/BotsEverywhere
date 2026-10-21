import { useEffect, useState } from 'react'
import { profileFromOrg, type OrgDocument, type OrgProfile, type SeatDocument } from '../../server/src/org-files.ts'
import type { SyncStatus } from '../../server/src/grok-sync.ts'
import { storedProfile } from '../org/load'
import { Button } from '../components/Button'
import { ConnectGrok } from '../components/ConnectGrok'
import { LinkCompany } from '../components/LinkCompany'
import { OrgFiles } from '../components/OrgFiles'
import { FileGuide } from '../components/FileGuide'
import { SaveAlert } from '../components/SaveAlert'
import { saveNotice, type SaveNotice } from '../components/save-notice'
import { accountRows, grokSyncTag, legendCounts, legendGroup, LEGEND_TITLES, retiredGroups, seatListMeta, type LegendGroup } from '../components/sync-copy'
import { RetiredDrawer } from '../components/RetiredDrawer'
import { SeatListDrawer } from '../components/SeatListDrawer'

const SAVING_OFF = 'Saving is off. Restart npm run dev, then save this overview.'

export function CompanyOverview({
  section,
  slug,
  org,
  seats,
  editable,
  sample,
  onOrg,
  onImported,
  onAddExisting,
  sync = null,
  onSyncChanged,
  chartHref = '',
}: {
  /** Organization Overview, Connect bots, or Backup. */
  section: 'overview' | 'connect' | 'backup'
  /** The writer's view of Grok Bot for this org, for the Connector step. */
  sync?: SyncStatus | null
  slug: string
  org: OrgDocument
  seats: SeatDocument[]
  editable: boolean
  sample: boolean
  onOrg: (org: OrgDocument) => void
  onImported: () => Promise<void>
  onAddExisting: () => void
  /** Re-reads the sync status after the Connector interval is saved. */
  onSyncChanged?: () => Promise<void>
  /** The org chart of this organization. A name in an Overview list opens it on that seat. */
  chartHref?: string
}) {
  const derived = profileFromOrg(org, seats)
  const stored = storedProfile(sample ? 'sample' : 'user', slug)
  const [profile, setProfile] = useState<OrgProfile>(stored ?? derived)
  const [notice, setNotice] = useState<SaveNotice | null>(null)
  const [saving, setSaving] = useState(false)
  // Counted from the org chart, the same way as its legend. They are not typed in.
  const active = seats.filter((seat) => seat.status !== 'retired').map((seat) => ({ id: seat.slug, type: seat.kind, grokSync: seat.grokSync, grokBotUrl: seat.grokBotUrl }))
  const counts = legendCounts(active)
  const retired = seats.filter((seat) => seat.status === 'retired')
  // The box whose seats are listed: a legend group, or Retired.
  const [listed, setListed] = useState<LegendGroup | 'retired' | null>(null)
  const listable = editable && Boolean(chartHref)
  const titleOf = new Map(seats.map((seat) => [seat.slug, seat.title]))
  const account = sync?.project?.account ?? null
  const listedRows = listed === 'in-grok' && account
    ? accountRows(account)
    : listed && listed !== 'retired'
    ? legendGroup(active, listed).flatMap((item) => {
      const seat = seats.find((entry) => entry.slug === item.id)
      if (!seat) return []
      return [{
        id: seat.slug,
        name: seat.title,
        meta: seatListMeta(seat.role, seat.title, seat.reportsTo ? titleOf.get(seat.reportsTo) ?? seat.reportsTo : ''),
        tag: seat.kind === 'bot' ? grokSyncTag(seat) : undefined,
      }]
    })
    : []

  /** One count box. On an org of your own it opens the seats it counts. */
  function countBox(label: string, value: number, group: LegendGroup | 'retired') {
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          {listable ? (
            <Button variant="ghost" type="button" className="overview-count" disabled={value === 0} onClick={() => setListed(group)} aria-label={`${label}: ${value}. Show the list`}>{value}</Button>
          ) : value}
        </dd>
      </div>
    )
  }

  useEffect(() => {
    if (!editable) return
    let cancel = false
    fetch(`/api/orgs/${slug}/profile`)
      .then(async (response) => {
        if (cancel || !response.ok) return
        const next = await response.json() as OrgProfile
        if (next && typeof next.name === 'string') setProfile(next)
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [editable, slug])

  async function save() {
    if (!editable || saving) return
    if (!profile.name.trim()) {
      setNotice(saveNotice(false, 'Organization name is required.'))
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/orgs/${slug}/profile`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...profile, people: counts.human, bots: counts.bot }),
      })
      const text = await response.text()
      if (!text.trimStart().startsWith('{')) {
        setNotice(saveNotice(false, SAVING_OFF))
        setSaving(false)
        return
      }
      const body = JSON.parse(text) as { ok?: boolean; errors?: string[] }
      if (!response.ok) {
        setNotice(saveNotice(false, body.errors?.join(' ') || 'Could not save the overview.'))
        setSaving(false)
        return
      }
      onOrg({
        ...org,
        company: {
          ...org.company,
          name: profile.name.trim(),
          tagline: profile.description.trim(),
          industry: profile.industry.trim(),
        },
      })
      setNotice(saveNotice(true, 'Org saved'))
    } catch {
      setNotice(saveNotice(false, SAVING_OFF))
    }
    setSaving(false)
  }

  async function reloadProfile() {
    const response = await fetch(`/api/orgs/${slug}/profile`)
    if (!response.ok) return
    const next = await response.json() as OrgProfile
    if (next && typeof next.name === 'string') setProfile(next)
  }

  return (
    <>
    {section === 'connect' ? <ConnectGrok status={sync} editable={editable} onIntervalSaved={onSyncChanged} /> : null}
    {section === 'connect' && editable ? (
      <LinkCompany
        slug={slug}
        seats={seats}
        onImported={async () => { await onImported(); await reloadProfile() }}
        onAddExisting={onAddExisting}
        onCompanyFields={() => { window.location.hash = `#/org/${slug}/overview` }}
      />
    ) : null}
    <div className="overview">
      {section !== 'connect' ? <h1>{profile.name || 'Organization overview'}</h1> : null}
      {section === 'overview' ? (
      <form id="company-fields" className="overview-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Field label="Organization name" placeholder="Your organization name" value={profile.name} disabled={!editable} onChange={(name) => setProfile({ ...profile, name })} />
      <Field label="Short description" placeholder="What your organization does" value={profile.description} disabled={!editable} onChange={(description) => setProfile({ ...profile, description })} />
      <label>
        Purpose / mission
        <textarea placeholder="What this org is for" value={profile.purpose} disabled={!editable} onChange={(event) => setProfile({ ...profile, purpose: event.target.value })} />
      </label>
      <Field label="Industry" placeholder="Industry" value={profile.industry} disabled={!editable} onChange={(industry) => setProfile({ ...profile, industry })} />
      <dl className="overview-counts">
        {countBox('People', counts.human, 'human')}
        {countBox('Bots', counts.bot, 'bot')}
        {countBox('In Grok Bot', account ? account.total : counts.inGrok, 'in-grok')}
        {countBox('Not in Grok Bot', counts.offGrok, 'off-grok')}
        {countBox('System', counts.system, 'system')}
        {countBox('Retired', retiredGroups(retired).length, 'retired')}
      </dl>
      <p className="overview-note">
        Counted from the org chart.{account ? ' In Grok Bot counts every bot in your Grok Bot account, whatever its organization, from the Connector\'s last report.' : ''}
        {listable ? ' Choose a number to see who it counts.' : ''}
      </p>
      {listed === 'retired' ? (
        <RetiredDrawer seats={retired} activeElsewhere={sync?.retiredElsewhere ?? {}} onClose={() => setListed(null)} />
      ) : listed ? (
        <SeatListDrawer
          title={listed === 'human' ? 'People' : LEGEND_TITLES[listed]}
          note={listed === 'in-grok' && account ? "Every bot in your Grok Bot account, whatever its organization, from the Connector's last report. Choose one on this chart to find it." : undefined}
          rows={listedRows}
          onPick={(id) => { window.location.hash = `${chartHref}?seat=${encodeURIComponent(id)}` }}
          onClose={() => setListed(null)}
        />
      ) : null}
      {editable ? (
        <Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save overview'}</Button>
      ) : (
        <p className="overview-note">This overview is read-only.</p>
      )}
      {notice ? <SaveAlert kind={notice.kind}>{notice.message}</SaveAlert> : null}
      </form>
      ) : null}
      {section === 'overview' && editable ? <FileGuide slug={slug} /> : null}
      {section === 'backup' && editable ? (
        <section className="org-backup" aria-labelledby="backup-title">
          <h2 id="backup-title">Backup</h2>
          <OrgFiles slug={slug} onImported={async () => { await onImported(); await reloadProfile() }} />
        </section>
      ) : null}
    </div>
    </>
  )
}

function Field({ label, value, disabled, onChange, placeholder }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label>
      {label}
      <input value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
