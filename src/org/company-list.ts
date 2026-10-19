export type ListedCompany = { slug: string; name: string }

const listeners = new Set<() => void>()

/** The port dev-all actually bound, or '' so callers use the same-origin /api proxy. */
export function writerApiOrigin(port: string | undefined = readWriterPort()): string {
  if (typeof port === 'string' && /^[1-9]\d*$/.test(port)) return `http://127.0.0.1:${port}`
  return ''
}

export function orgsEndpoint(origin: string): string {
  const base = origin.replace(/\/$/, '')
  return base ? `${base}/api/orgs` : '/api/orgs'
}

export function withCurrent(listed: ListedCompany[], current: ListedCompany): ListedCompany[] {
  const next = listed.some((item) => item.slug === current.slug) ? listed.slice() : [current, ...listed]
  next.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug))
  return next
}

/** Live list from the writer. Throws when the writer does not answer. */
export async function loadCompanies(origin: string, fetchImpl: typeof fetch = fetch): Promise<ListedCompany[]> {
  const response = await fetchImpl(orgsEndpoint(origin), { cache: 'no-store' })
  if (!response.ok) throw new Error(`Org list failed (${response.status})`)
  const body = (await response.json()) as { orgs?: { slug?: string; name?: string }[] }
  const listed = (body.orgs ?? [])
    .filter((item): item is { slug: string; name?: string } => Boolean(item.slug))
    .map((item) => ({ slug: item.slug, name: item.name || item.slug }))
  listed.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug))
  return listed
}

export function subscribeCompanies(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Create, import, and template copy call this so an open menu does not keep a stale list. */
export function companiesChanged(): void {
  for (const listener of listeners) listener()
}

function readWriterPort(): string | undefined {
  const env = import.meta.env as { VITE_WRITER_PORT?: string } | undefined
  return env?.VITE_WRITER_PORT
}
