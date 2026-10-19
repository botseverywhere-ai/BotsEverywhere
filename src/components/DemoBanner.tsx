const repo = import.meta.env.VITE_REPO_URL || ''

export function DemoBanner() {
  return (
    <div className="be-banner">
      <p>
        Read-only demo. Sample data only. Nothing you change here is saved. Run it yourself to keep your own org on your
        computer.
      </p>
      <a href={repo || '#docs'}>Get it on GitHub →</a>
    </div>
  )
}
