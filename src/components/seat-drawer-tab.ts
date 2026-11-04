export type SeatDrawerTab = 'card' | 'performance' | 'profile'

/** A newly selected seat starts on the seat card. A tab click sticks to that seat. */
export function shownSeatTab(selectedId: string, seatTab: { id: string; tab: SeatDrawerTab }): SeatDrawerTab {
  return seatTab.id === selectedId ? seatTab.tab : 'card'
}
