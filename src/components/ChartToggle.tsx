import type { KeyboardEvent } from 'react'

export function ChartToggle({ mode, onSelect }: { mode: 'org' | 'work'; onSelect?: (mode: 'org' | 'work') => void }) {
  function go(next: 'org' | 'work', focus = false) {
    if (onSelect) onSelect(next)
    else window.location.hash = next
    if (!focus) return
    const tab = document.getElementById(next === 'org' ? 'tab-org' : 'tab-work')
    tab?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    go(mode === 'org' ? 'work' : 'org', true)
  }

  return (
    <div className="toggle" role="tablist" aria-label="Chart" onKeyDown={onKeyDown}>
      <button
        type="button"
        role="tab"
        id="tab-org"
        className={mode === 'org' ? 'active' : undefined}
        aria-selected={mode === 'org'}
        aria-controls="chart-panel"
        tabIndex={mode === 'org' ? 0 : -1}
        onClick={() => go('org')}
      >
        Org chart
      </button>
      <button
        type="button"
        role="tab"
        id="tab-work"
        className={mode === 'work' ? 'active' : undefined}
        aria-selected={mode === 'work'}
        aria-controls="chart-panel"
        tabIndex={mode === 'work' ? 0 : -1}
        onClick={() => go('work')}
      >
        Work chart
      </button>
    </div>
  )
}
