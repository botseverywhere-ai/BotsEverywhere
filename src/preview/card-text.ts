/** Removes the handbook tag from seat-card copy. The provenance field keeps the source. */
const HANDBOOK_TAG = /\s*\(from handbook v1[^)]*\)/g

export function displayCardText(text: string): string {
  return text.replace(HANDBOOK_TAG, '').replace(/[ \t]{2,}/g, ' ').trim()
}
