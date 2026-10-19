import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { readText } from './text-file.ts'
import { resolve } from 'node:path'
import { formatRunLine, isRunLogName, parseRunLog, runLogHeader, type RunLine } from './run-log.ts'

export function appendRunLine(orgDir: string, line: RunLine): string {
  const dir = resolve(orgDir, 'log')
  mkdirSync(dir, { recursive: true })
  const name = `${line.date}.md`
  const path = resolve(dir, name)
  const row = `${formatRunLine(line)}\n`
  if (!existsSync(path)) writeFileSync(path, `${runLogHeader(line.date)}\n${row}`)
  else appendFileSync(path, row)
  return `log/${name}`
}

export function readRunLogDir(orgDir: string): { lines: RunLine[]; skipped: number } {
  const dir = resolve(orgDir, 'log')
  if (!existsSync(dir)) return { lines: [], skipped: 0 }
  const lines: RunLine[] = []
  let skipped = 0
  let index = 0
  for (const name of readdirSync(dir).filter((item) => isRunLogName(item)).sort()) {
    let parsed: ReturnType<typeof parseRunLog>
    try {
      parsed = parseRunLog(readText(resolve(dir, name)), name.slice(0, 10))
    } catch {
      skipped += 1
      continue
    }
    skipped += parsed.skipped
    for (const line of parsed.lines) lines.push({ ...line, index: index++ })
  }
  return { lines, skipped }
}

export async function playRun(orgDir: string, lines: RunLine[], paceMs: number, onWrite?: () => void): Promise<number> {
  let wrote = 0
  for (const line of lines) {
    if (wrote > 0 && paceMs > 0) await delay(paceMs)
    appendRunLine(orgDir, line)
    wrote += 1
    onWrite?.()
  }
  return wrote
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
