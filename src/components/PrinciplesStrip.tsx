import { useState } from 'react'
import { CREDIT, PRINCIPLE_SEPARATOR, PRINCIPLES } from '../content/principles'

const STORAGE_KEY = 'be-hiring-rules'

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) !== 'closed'
  } catch {
    return true
  }
}

/** Thin hiring-rules row under the app sub-bar. Copy is static. */
export function PrinciplesStrip({ present = false }: { present?: boolean }) {
  const [open, setOpen] = useState(readOpen)
  const shown = present || open

  function toggle() {
    const next = !open
    setOpen(next)
    try {
      sessionStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed')
    } catch {
      /* session storage can be blocked; the row still toggles for this view */
    }
  }

  return (
    <section className={shown ? 'be-principles is-open' : 'be-principles is-collapsed'} aria-label="Hiring rules">
      <ul className="sr-only">
        {PRINCIPLES.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
      <div className="be-principles-wide">
        {shown ? (
          <div className="be-principles-row">
            <p className="be-principles-lead">Hiring rules</p>
            <div className="be-principles-items">
              {PRINCIPLES.map((item, index) => (
                <span className="be-principles-item" key={item.id}>
                  {index > 0 ? <span className="be-principles-sep" aria-hidden="true">{PRINCIPLE_SEPARATOR}</span> : null}
                  <button type="button" className="be-principle" aria-describedby={`principle-${item.id}`}>
                    <span className="be-principle-label">{item.label}</span>
                    <span className="be-principle-full">{item.text}</span>
                  </button>
                  <span className="be-principle-tip" id={`principle-${item.id}`} role="tooltip">{item.text}</span>
                </span>
              ))}
            </div>
            <a className="be-principles-credit" href={CREDIT.url} target="_blank" rel="noopener" title={CREDIT.text}>
              <span className="be-credit-full">{CREDIT.text}</span>
              <span className="be-credit-short">{CREDIT.short}</span>
            </a>
          </div>
        ) : null}
        {present ? null : (
          <button type="button" className="be-principles-toggle" onClick={toggle}>
            {shown ? 'Hide' : 'Show hiring rules'}
          </button>
        )}
      </div>
      <details className="be-principles-narrow">
        <summary>Hiring rules (7)</summary>
        <ol>
          {PRINCIPLES.map((item) => (
            <li key={item.id}>{item.text}</li>
          ))}
        </ol>
        <a href={CREDIT.url} target="_blank" rel="noopener" title={CREDIT.text}>{CREDIT.text}</a>
      </details>
    </section>
  )
}
