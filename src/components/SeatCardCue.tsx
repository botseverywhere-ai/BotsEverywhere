import { UNSTAFFED_LINE } from '../content/principles'

/** Seat-card reminder on an unstaffed step or empty seat. */
export function SeatCardCue({ hire, onHire }: { hire: boolean; onHire: () => void }) {
  return (
    <span className="be-seat-card-line" title={UNSTAFFED_LINE}>
      <span className="be-seat-card-text">{UNSTAFFED_LINE}</span>
      {hire ? (
        <button type="button" className="be-hire-link" onClick={(event) => { event.stopPropagation(); onHire() }}>
          + Hire
        </button>
      ) : null}
    </span>
  )
}
