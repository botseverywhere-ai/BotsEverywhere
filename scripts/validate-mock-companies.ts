import { readFileSync } from 'node:fs'
import { validateMockCompanies } from '../src/data/validate-mock-companies.ts'
import type { MockSeed } from '../src/data/mock-companies.ts'

const seed = JSON.parse(readFileSync(new URL('../src/data/mock-companies.json', import.meta.url), 'utf8')) as MockSeed
const errors = validateMockCompanies(seed)
if (errors.length) {
  for (const error of errors) console.error(error)
  process.exit(1)
}
console.info(`Validated ${seed.companies.length} mock organizations.`)
