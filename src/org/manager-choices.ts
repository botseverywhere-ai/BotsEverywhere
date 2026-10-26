/**
 * Who a new seat reports to, and who a change is credited to, unless someone else is picked: You, then the person at the
 * top, then any person. Never just the first person by file name, which put Angel before You.
 */
export function defaultManager<T extends { slug: string; title: string; kind: string; status: string; reportsTo?: string }>(seats: T[]): T | undefined {
  const active = seats.filter((seat) => seat.status !== 'retired')
  return active.find((seat) => seat.title.trim().toLowerCase() === 'you')
    ?? active.find((seat) => seat.slug === 'you')
    ?? active.find((seat) => seat.kind === 'human' && !seat.reportsTo)
    ?? active.find((seat) => seat.kind === 'human')
}

/** Seats a given seat may report to: active, not itself, and not one of its own reports. */
export function managerChoices(
  seats: { slug: string; title: string; reportsTo: string; status: string }[],
  slug: string,
): { slug: string; title: string }[] {
  const below = new Set<string>([slug])
  let grew = true
  while (grew) {
    grew = false
    for (const seat of seats) {
      if (!below.has(seat.slug) && seat.reportsTo && below.has(seat.reportsTo)) {
        below.add(seat.slug)
        grew = true
      }
    }
  }
  return seats
    .filter((seat) => seat.status !== 'retired' && !below.has(seat.slug))
    .map((seat) => ({ slug: seat.slug, title: seat.title }))
}
