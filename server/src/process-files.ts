import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readText } from './text-file.ts'
import { resolve } from 'node:path'
import { SEAT_SLUG } from './org-files.ts'
import {
  matchStepSeats,
  parseProcessMarkdown,
  processSlug,
  serializeProcess,
  type ProcessFile,
  type ProcessImportRow,
} from './processes.ts'

export function readProcessDir(dir: string): { processes: ProcessFile[]; notes: string[] } {
  const folder = resolve(dir, 'processes')
  if (!existsSync(folder)) return { processes: [], notes: [] }
  const processes: ProcessFile[] = []
  const notes: string[] = []
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.md')).sort()) {
    const slug = file.slice(0, -3)
    let parsed: ReturnType<typeof parseProcessMarkdown>
    try {
      parsed = parseProcessMarkdown(slug, readText(resolve(folder, file)))
    } catch (error) {
      notes.push(`${file}: ${error instanceof Error ? error.message : 'could not read this file.'}`)
      continue
    }
    if (!parsed.ok) notes.push(...parsed.errors)
    else processes.push(parsed.process)
  }
  return { processes, notes }
}

export function writeProcessFile(dir: string, process: ProcessFile, previousSlug = ''): { ok: true; slug: string; file: string } | { ok: false; errors: string[] } {
  const slug = process.slug.trim()
  if (!SEAT_SLUG.test(slug) || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    return { ok: false, errors: ['That process name is not a safe file name.'] }
  }
  if (previousSlug && previousSlug !== slug && (previousSlug.includes('..') || previousSlug.includes('/') || !SEAT_SLUG.test(previousSlug))) {
    return { ok: false, errors: ['That process name is not a safe file name.'] }
  }
  const folder = resolve(dir, 'processes')
  mkdirSync(folder, { recursive: true })
  const path = resolve(folder, `${slug}.md`)
  writeFileSync(path, serializeProcess({ ...process, slug }))
  if (previousSlug && previousSlug !== slug) rmSync(resolve(folder, `${previousSlug}.md`), { force: true })
  return { ok: true, slug, file: `processes/${slug}.md` }
}

export function deleteProcessFile(dir: string, slug: string): { ok: true } | { ok: false; errors: string[] } {
  if (!SEAT_SLUG.test(slug) || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    return { ok: false, errors: ['That process name is not a safe file name.'] }
  }
  rmSync(resolve(dir, 'processes', `${slug}.md`), { force: true })
  return { ok: true }
}

/**
 * Writes the flows in a processes file from Grok Bot. Grok Bot is where the work runs and the app does not edit flows,
 * so a flow of the same name is replaced by Grok Bot's version, keeping only its notes. A name listed twice in one file
 * keeps the first. `replaced` says which flows were already here.
 */
export function importProcessRows(
  dir: string,
  rows: ProcessImportRow[],
  seats: { slug: string; title: string }[],
): { imported: { name: string; slug: string; file: string; replaced: boolean }[]; errors: { name: string; error: string }[]; notes: string[] } {
  const errors: { name: string; error: string }[] = []
  const notes: string[] = []
  const imported: { name: string; slug: string; file: string; replaced: boolean }[] = []
  const existing = new Map(readProcessDir(dir).processes.map((process) => [process.slug, process]))
  const written = new Set<string>()
  for (const row of rows) {
    if (row.error) {
      errors.push({ name: row.name || 'Process', error: row.error })
      continue
    }
    const matched = matchStepSeats(row.steps, seats)
    const slug = processSlug(row.name)
    if (!slug || !SEAT_SLUG.test(slug)) {
      errors.push({ name: row.name, error: 'Could not pick a free file name for that process.' })
      continue
    }
    if (written.has(slug)) {
      errors.push({ name: row.name, error: 'Listed twice in this file. The first one was kept.' })
      continue
    }
    const previous = existing.get(slug)
    const saved = writeProcessFile(dir, {
      slug,
      name: row.name,
      trigger: row.trigger,
      steps: matched.steps,
      doneWhen: row.doneWhen,
      next: row.next,
      notes: previous?.notes ?? '',
    })
    if (!saved.ok) {
      errors.push({ name: row.name, error: saved.errors.join(' ') })
      continue
    }
    written.add(saved.slug)
    imported.push({ name: row.name, slug: saved.slug, file: saved.file, replaced: Boolean(previous) })
    notes.push(...row.notes, ...matched.notes.map((note) => `${row.name}: ${note}`))
  }
  return { imported, errors, notes }
}
