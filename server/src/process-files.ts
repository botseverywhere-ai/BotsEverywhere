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

/** The shape the sync writes for a routine: one step that only repeats the routine's name, and nothing else filled in. */
function syncMade(process: ProcessFile): boolean {
  const norm = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
  return process.steps.length === 1 && norm(process.steps[0]!.action) === norm(process.name)
    && !process.doneWhen.trim() && !process.next.trim() && !process.notes.trim()
}

export function importProcessRows(
  dir: string,
  rows: ProcessImportRow[],
  seats: { slug: string; title: string }[],
): { imported: { name: string; slug: string; file: string }[]; errors: { name: string; error: string }[]; notes: string[] } {
  const errors: { name: string; error: string }[] = []
  const notes: string[] = []
  const imported: { name: string; slug: string; file: string }[] = []
  const existing = readProcessDir(dir).processes
  const taken = new Set(existing.map((process) => process.slug))
  // A flow the sync made from a routine and nobody changed holds no work of yours, so a full version replaces it, once.
  const replaceable = new Set(existing.filter(syncMade).map((process) => process.slug))
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
    if (taken.has(slug) && !replaceable.has(slug)) {
      errors.push({ name: row.name, error: 'Already in this organization. The existing process was kept.' })
      continue
    }
    replaceable.delete(slug)
    const written = writeProcessFile(dir, {
      slug,
      name: row.name,
      trigger: row.trigger,
      steps: matched.steps,
      doneWhen: row.doneWhen,
      next: row.next,
      notes: '',
    })
    if (!written.ok) {
      errors.push({ name: row.name, error: written.errors.join(' ') })
      continue
    }
    taken.add(written.slug)
    imported.push({ name: row.name, slug: written.slug, file: written.file })
    notes.push(...row.notes, ...matched.notes.map((note) => `${row.name}: ${note}`))
  }
  return { imported, errors, notes }
}
