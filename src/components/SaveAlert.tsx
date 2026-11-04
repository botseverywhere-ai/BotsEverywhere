import type { ReactNode } from 'react'
import type { SaveNotice } from './save-notice'

export function SaveAlert({ kind, children }: { kind: SaveNotice['kind']; children: ReactNode }) {
  return (
    <p className={kind === 'ok' ? 'save-alert is-ok' : 'save-alert is-bad'} role={kind === 'ok' ? 'status' : 'alert'}>
      {children}
    </p>
  )
}
