import { isGreyed } from '../../server/src/org-files.ts'

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

type ChoiceSeat = { slug: string; title: string; reportsTo: string; alsoReportsTo?: string[]; status: string; grokBotUrl?: string; elsewhereUrl?: string }

/** The seat and everyone who reports to it, on a solid or a dotted line. */
function reportsBelow(seats: ChoiceSeat[], slug: string): Set<string> {
  const below = new Set<string>([slug])
  let grew = true
  while (grew) {
    grew = false
    for (const seat of seats) {
      if (!below.has(seat.slug) && [seat.reportsTo, ...(seat.alsoReportsTo ?? [])].some((manager) => manager && below.has(manager))) {
        below.add(seat.slug)
        grew = true
      }
    }
  }
  return below
}

/** Seats a given seat may report to: active, not itself, and not one of its own reports. */
export function managerChoices(seats: ChoiceSeat[], slug: string): { slug: string; title: string }[] {
  const below = reportsBelow(seats, slug)
  return seats
    .filter((seat) => seat.status !== 'retired' && !below.has(seat.slug) && !isGreyed(seat))
    .map((seat) => ({ slug: seat.slug, title: seat.title }))
}

/**
 * Seats a given seat may also report to: active, not itself, and not its main manager. One of its own reports stays
 * listed but disabled, with why. A retired extra manager it already has stays listed so it can be unticked.
 */
export function alsoChoices(seats: ChoiceSeat[], slug: string): { slug: string; title: string; disabled?: string }[] {
  const seat = seats.find((item) => item.slug === slug)
  if (!seat) return []
  const below = reportsBelow(seats, slug)
  const current = seat.alsoReportsTo ?? []
  return seats
    .filter((item) => item.slug !== slug && item.slug !== seat.reportsTo && !isGreyed(item) && (item.status !== 'retired' || current.includes(item.slug)))
    .map((item) => {
      if (item.status === 'retired') return { slug: item.slug, title: `${item.title} (retired)` }
      if (below.has(item.slug) && !current.includes(item.slug)) return { slug: item.slug, title: item.title, disabled: `${item.title} already reports to ${seat.title}, so this would make a loop.` }
      return { slug: item.slug, title: item.title }
    })
}
