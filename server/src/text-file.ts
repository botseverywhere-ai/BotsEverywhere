import { readFileSync } from 'node:fs'
import { normalizeText } from './normalize-text.ts'

export { normalizeText }

export function readText(path: string): string {
  return normalizeText(readFileSync(path, 'utf8'))
}
