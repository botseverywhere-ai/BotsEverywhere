import cards from '../generated/sample-cards.json'

export interface SampleCard {
  id: string
  name: string
  industry: string
  tagline: string
  mark: string
  humans: number
  bots: number
  label: string
}

/** Names and counts for the homepage and template list. Full orgs load on open. */
export const sampleCards: SampleCard[] = cards
