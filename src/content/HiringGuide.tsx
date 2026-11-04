import { HIRING_GUIDE_LEAD, HIRING_GUIDE_POINTS, HIRING_GUIDE_TITLE } from './hiring-guide.ts'

export function HiringGuide({ collapsed = false }: { collapsed?: boolean }) {
  const body = (
    <>
      <p>{HIRING_GUIDE_LEAD}</p>
      <ul>
        {HIRING_GUIDE_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </>
  )
  if (!collapsed) return <div className="be-hiring-guide">{body}</div>
  return (
    <details className="be-hiring-guide">
      <summary>{HIRING_GUIDE_TITLE}</summary>
      {body}
    </details>
  )
}
