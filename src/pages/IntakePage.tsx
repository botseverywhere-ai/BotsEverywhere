import { useState } from 'react'
import { ChartBoard } from './SeedCharts'
import { intakeCompany } from '../data/intake-company'
import { Button } from '../components/Button'

const TRIGGERS = ['Directive', 'Objective', 'Problem', 'Event'] as const
type Trigger = (typeof TRIGGERS)[number]

const EXAMPLES: Record<Trigger, string> = {
  Directive: '“Ship the Nov 7 Grok Bot Alicante demo narrative with Research, Writing, and Site seats.”',
  Objective: '“Have a human-approved demo narrative live before Nov 7.”',
  Problem: '“Org seats exist but work is not moving toward the Alicante demo.”',
  Event: '“Grok Bot Alicante · November 07, 2026 — need narrative + site + X thread.”',
}

export function IntakePage() {
  const [trigger, setTrigger] = useState<Trigger>('Directive')
  const [classified, setClassified] = useState(false)
  const [mode, setMode] = useState<'org' | 'work'>('work')
  const company = intakeCompany(trigger, EXAMPLES[trigger])

  return (
    <main id="main" className="app-main view-fade">
      <div className="nav-crumbs">
        <a href="#home">Seed team</a>
        <span className="sep">/</span>
        <span>Work intake</span>
      </div>
      <div className="screen-bar">
        <div className="screen-title">
          <h1>Start from work intake</h1>
          <p>Work starts at intake — not CEO columns. Presets only.</p>
        </div>
      </div>

      <div className="card intake-card">
        <p id="trigger-label" className="field-label">
          Pick a trigger
        </p>
        <div className="chips" role="group" aria-labelledby="trigger-label">
          {TRIGGERS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === trigger ? 'chip active' : 'chip'}
              aria-pressed={item === trigger}
              onClick={() => {
                setTrigger(item)
                setClassified(false)
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="example-box">{EXAMPLES[trigger]}</div>
        <div className="intake-actions">
          <Button variant="primary" type="button"  onClick={() => setClassified(true)}>
            Classify → temporary chart
          </Button>
          <Button variant="secondary"  href="#home">
            Cancel
          </Button>
        </div>
        <div className={classified ? 'classify-result show' : 'classify-result'} aria-live="polite">
          {classified ? (
            <>
              <strong>Construct temporary chart</strong> — no existing workflow match for this seed.
              <br />
              Seats suggested: Research Bot · Social Post Bot · Website Bot → Founder approve.
            </>
          ) : null}
        </div>
      </div>
      {classified ? (
        <div className="intake-chart" data-testid="intake-chart">
          <ChartBoard key={company.org.id} company={company} mode={mode} onMode={setMode} embedded />
        </div>
      ) : null}
    </main>
  )
}
