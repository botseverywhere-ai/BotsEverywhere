import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseProfileReport } from './profile-reports.ts'
import { readText } from './text-file.ts'

/** The folder in each organization where its bots write their own profiles, one <seat>.md each. */
export const PROFILES_DIR = 'profiles'

/** A profile file is a few lines; anything this big is not one. */
const MAX_BYTES = 64 * 1024

/**
 * The profiles bots wrote into their organizations' folders, in the shape of a profile they sent: the file's text, the
 * seat as who it came from, and when the file was written. Bots write these themselves on their own runs, so nothing
 * waits for a message. A file whose header names another organization or seat, or that cannot be read, is skipped.
 * Never throws.
 */
export function profileFileLines(orgsDir: string, orgIds: string[]): { line: string; from: string; at: string }[] {
  const lines: { line: string; from: string; at: string }[] = []
  for (const orgId of orgIds) {
    const folder = resolve(orgsDir, orgId, PROFILES_DIR)
    let names: string[]
    try {
      names = readdirSync(folder).filter((name) => name.endsWith('.md')).sort()
    } catch {
      continue
    }
    for (const name of names) {
      try {
        const path = resolve(folder, name)
        const stat = statSync(path)
        if (!stat.isFile() || stat.size > MAX_BYTES) continue
        const line = readText(path)
        const seat = name.slice(0, -3)
        const report = parseProfileReport(line)
        if (!report || report.org !== orgId || report.seat !== seat) continue
        lines.push({ line, from: seat, at: stat.mtime.toISOString() })
      } catch {
        continue
      }
    }
  }
  return lines
}
