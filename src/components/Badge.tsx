import type { SeatStatus } from '../data/seats'

const LABEL: Record<SeatStatus, string> = {
  staffed: 'Staffed',
  review: 'In review',
  empty: 'Empty',
  human: 'Human',
}

export function Badge({
  status,
  dot = false,
  caps = false,
}: {
  status: SeatStatus
  dot?: boolean
  caps?: boolean
}) {
  const mark = !dot ? '' : status === 'empty' ? '○ ' : '● '
  const text = caps ? LABEL[status].toUpperCase() : LABEL[status]
  return <span className={`badge ${status}${caps ? ' caps' : ''}`}>{mark}{text}</span>
}
