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
