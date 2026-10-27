import { watch, type FSWatcher } from 'node:fs'
import type { ServerResponse } from 'node:http'

export type LiveKind = 'log' | 'processes' | 'org' | 'grok'

export function createLiveHub(orgsDir: string, onChange?: (change: { slug: string; kind: LiveKind }) => void) {
  const clients = new Map<string, Set<ServerResponse>>()
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  let watcher: FSWatcher | null = null

  function publish(slug: string, kind: LiveKind) {
    const key = `${slug}:${kind}`
    const existing = pending.get(key)
    if (existing) clearTimeout(existing)
    pending.set(key, setTimeout(() => {
      pending.delete(key)
      const sets = slug === '*' ? [...clients.values()] : [clients.get(slug)]
      const payload = `event: ${kind}\ndata: {}\n\n`
      for (const set of sets) {
        if (!set) continue
        for (const res of set) {
          try {
            res.write(payload)
          } catch {
            set.delete(res)
          }
        }
      }
    }, 40))
  }

  function subscribe(slug: string, res: ServerResponse): () => void {
    const set = clients.get(slug) ?? new Set()
    set.add(res)
    clients.set(slug, set)
    return () => {
      set.delete(res)
    }
  }

  const reported = new Set<string>()

  function open() {
    try {
      watcher = watch(orgsDir, { recursive: true }, (_event, filename) => {
        const key = filename ? String(filename) : ''
        try {
          const change = orgChange(orgsDir, key)
          if (change) {
            publish(change.slug, change.kind)
            onChange?.(change)
          }
        } catch (error) {
          reportWatchError(reported, key, error)
        }
      })
      watcher.on('error', (error) => {
        reportWatchError(reported, 'watcher', error)
      })
    } catch (error) {
      reportWatchError(reported, 'watcher', error)
      watcher = null
    }
  }

  function close() {
    watcher?.close()
    watcher = null
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
    for (const set of clients.values()) {
      for (const res of set) {
        try {
          res.end()
        } catch {
          // The browser already hung up.
        }
      }
    }
    clients.clear()
  }

  open()
  return { publish, subscribe, close }
}

/** Log a bad watch path once. Further events for the same path are ignored. */
export function reportWatchError(seen: Set<string>, key: string, error: unknown, log: (line: string) => void = console.error): void {
  if (seen.has(key)) return
  seen.add(key)
  const reason = error instanceof Error ? error.message : 'unreadable file'
  log(`Skipped ${key || 'an org file'}: ${reason}`)
}

export function orgChange(orgsDir: string, filename: string): { slug: string; kind: LiveKind } | null {
  const rel = filename.replace(/\\/g, '/')
  const base = orgsDir.replace(/\\/g, '/').replace(/\/$/, '')
  const cut = rel.startsWith(`${base}/`) ? rel.slice(base.length + 1) : rel.replace(/^\//, '')
  // The project Connector's files sit beside the org folders and concern every org.
  if (cut === 'connector.json' || cut === 'project.json' || cut === 'grok-data.json' || cut === 'connector-results.json') return { slug: '*', kind: 'grok' }
  const match = /^([^/]+)\/(log|processes|grok)\//.exec(cut)
  if (match?.[1] && match[2]) return { slug: match[1], kind: match[2] === 'processes' ? 'processes' : match[2] === 'grok' ? 'grok' : 'log' }
  const seat = /^([^/]+)\/seats\/[^/]+\.md$/.exec(cut)
  if (seat?.[1]) return { slug: seat[1], kind: 'org' }
  const orgFile = /^([^/]+)\/org\.md$/.exec(cut)
  if (orgFile?.[1]) return { slug: orgFile[1], kind: 'org' }
  return null
}
