import { sampleCards } from '../org/sample-cards'

/** Templates menu: the 10 fictional sample companies. Not mounted; templates are a page. */
export function SampleNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <details className="site-demos sample-nav">
      <summary>Templates</summary>
      <ul>
        {sampleCards.map((sample) => (
            <li key={sample.id}>
              <a href={`#/template/${sample.id}/overview`} onClick={onNavigate}>
                <span>{sample.name}</span>
                <small>{sample.label}</small>
              </a>
            </li>
          ))}
      </ul>
    </details>
  )
}
