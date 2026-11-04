/** BotsEverywhere is built for desktop browsers. Narrower screens get a notice, never a block. */
export const DESKTOP_MIN_WIDTH = 1024

export const SCREEN_NOTICE = `BotsEverywhere is built for desktop screens ${DESKTOP_MIN_WIDTH}px and wider. Some pages may not fit here. It is open source, so you can adapt the layout to your needs.`

export function showsScreenNotice(width: number, closed: boolean): boolean {
  return !closed && width < DESKTOP_MIN_WIDTH
}
