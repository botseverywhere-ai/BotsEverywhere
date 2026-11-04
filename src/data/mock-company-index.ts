import raw from './mock-companies.json'
import type { CompanySeed, MockSeed, Seat, Workstream } from './mock-companies.ts'

export const mockSeed = raw as MockSeed

export function listCompanies(): CompanySeed[] {
  return mockSeed.companies
}

export function findCompany(id: string): CompanySeed | undefined {
  return mockSeed.companies.find((company) => company.org.id === id)
}

export function seatsById(company: CompanySeed): Map<string, Seat> {
  return new Map(company.seats.map((seat) => [seat.id, seat]))
}

export function workstreamsById(company: CompanySeed): Map<string, Workstream> {
  return new Map(company.workstreams.map((stream) => [stream.id, stream]))
}
