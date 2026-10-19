export function TrustCue({
  mode,
  slug,
  saveDisabled,
  saveReason,
}: {
  mode: 'stored' | 'unsaved' | 'off' | 'sample' | 'showcase'
  slug: string
  unsaved?: number
  onSave?: () => void
  saveDisabled?: boolean
  saveReason?: string
}) {
  if (mode === 'showcase') {
    return (
      <p className="be-trust" title="This hosted demo is read-only. Run it yourself to keep orgs on your computer.">
        ○ Sample data · nothing is saved on this site
      </p>
    )
  }
  if (mode === 'sample') {
    return <p className="be-trust">Sample · read-only (samples/{slug}/)</p>
  }
  if (mode === 'off') {
    return (
      <p className="be-trust">
        Not saving: restart npm run dev to save to orgs/{slug}/
      </p>
    )
  }
  if (mode === 'unsaved') {
    return (
      <p className="be-trust">
        ● Unsaved changes
        {saveDisabled && saveReason ? <span className="be-trust-reason">{saveReason}</span> : null}
      </p>
    )
  }
  return (
    <p
      className="be-trust"
      title={`Saved as files in orgs/${slug}/ in this project when you choose Save files. Commit them with git.`}
    >
      ● Stored on this computer: orgs/{slug}/
    </p>
  )
}
