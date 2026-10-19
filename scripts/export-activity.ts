import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FileActivity } from '../server/src/org-files.ts'

const seed = JSON.parse(readFileSync(resolve('src/data/mock-companies.json'), 'utf8')) as {
  companies: { org: { id: string }; log?: FileActivity[] }[]
}

for (const company of seed.companies) {
  const events = company.log ?? []
  const body = events.map((event) => JSON.stringify(event)).join('\n')
  const path = resolve('samples', company.org.id, 'activity.jsonl')
  writeFileSync(path, body ? `${body}\n` : '')
  console.log(`${company.org.id}: ${events.length} events`)
}
