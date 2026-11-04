import { useEffect, useState } from 'react'
import { DESKTOP_MIN_WIDTH, SCREEN_NOTICE, showsScreenNotice } from '../content/screen-notice'
import { Button } from './Button'

const CLOSED_KEY = 'be-screen-notice-closed'

function wasClosed(): boolean {
  try {
    return sessionStorage.getItem(CLOSED_KEY) === '1'
  } catch {
    return false
  }
}

/** One quiet line above the page on screens narrower than the desktop minimum. Closed once per visit. */
export function ScreenNotice() {
  const [width, setWidth] = useState(() => window.innerWidth)
  const [closed, setClosed] = useState(wasClosed)
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`)
    const update = () => setWidth(window.innerWidth)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  if (!showsScreenNotice(width, closed)) return null
  return (
    <div className="screen-notice" role="note">
      <p>{SCREEN_NOTICE}</p>
      <Button
        variant="secondary"
        type="button"
        onClick={() => {
          try {
            sessionStorage.setItem(CLOSED_KEY, '1')
          } catch {
            // It still closes for this page.
          }
          setClosed(true)
        }}
      >
        Close
      </Button>
    </div>
  )
}
