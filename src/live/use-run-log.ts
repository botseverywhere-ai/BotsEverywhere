import { useEffect, useRef, useState } from 'react'
import type { RunLine } from '../../server/src/run-log.ts'
import { newRunLines } from './notices'

export function useRunLines(orgId: string, editable: boolean, bundled: RunLine[], onProcesses: () => void, onGrok?: () => void, onNewLines?: (lines: RunLine[]) => void): RunLine[] {
  const live = useLive(orgId, editable, onProcesses, onGrok, onNewLines)
  const replay = useReplay(bundled, !editable && bundled.length > 0)
  if (!editable && bundled.length > 0) return replay
  return live
}

function useLive(orgId: string, enabled: boolean, onProcesses: () => void, onGrok?: () => void, onNewLines?: (lines: RunLine[]) => void): RunLine[] {
  const [lines, setLines] = useState<RunLine[]>([])
  const onProcessesRef = useRef(onProcesses)
  const onGrokRef = useRef(onGrok)
  const onNewLinesRef = useRef(onNewLines)
  useEffect(() => {
    onProcessesRef.current = onProcesses
    onGrokRef.current = onGrok
    onNewLinesRef.current = onNewLines
  }, [onProcesses, onGrok, onNewLines])
  useEffect(() => {
    if (!enabled) return
    let stop = false
    // The first answer is the baseline; only lines after it are news.
    let seen: RunLine[] | null = null
    const load = () => {
      fetch(`/api/orgs/${orgId}/run-log`)
        .then(async (response) => (response.ok ? response.json() as Promise<{ lines?: RunLine[] }> : null))
        .then((body) => {
          if (stop || !body || !Array.isArray(body.lines)) return
          const fresh = seen ? newRunLines(seen, body.lines) : []
          seen = body.lines
          setLines(body.lines)
          if (fresh.length > 0) onNewLinesRef.current?.(fresh)
        })
        .catch(() => undefined)
    }
    load()
    const poll = window.setInterval(load, 2000)
    const source = new EventSource(`/api/orgs/${orgId}/live`)
    source.addEventListener('log', load)
    source.addEventListener('processes', () => onProcessesRef.current())
    source.addEventListener('org', () => onProcessesRef.current())
    source.addEventListener('grok', () => onGrokRef.current?.())
    return () => {
      stop = true
      window.clearInterval(poll)
      source.close()
    }
  }, [enabled, orgId])
  return lines
}

function useReplay(lines: RunLine[], on: boolean): RunLine[] {
  const [count, setCount] = useState(1)
  useEffect(() => {
    if (!on) return
    const timer = window.setInterval(() => {
      setCount((current) => (current >= lines.length ? 1 : current + 1))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [lines, on])
  return on ? lines.slice(0, Math.max(1, count)) : lines
}
