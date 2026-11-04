import { useSyncExternalStore } from 'react'
import { Button } from './Button'
import { SaveAlert } from './SaveAlert'
import { dismissNotice, notices, requestOpenSync, type Notice } from '../live/notices'

function useNotices(): Notice[] {
  return useSyncExternalStore(notices.subscribe, notices.get, notices.get)
}

function NoticeLinkView({ notice }: { notice: Notice }) {
  const link = notice.link
  if (!link) return null
  if ('href' in link) {
    return <a href={link.href} onClick={() => dismissNotice(notice.id)}>{link.label}</a>
  }
  return (
    <Button variant="ghost" type="button" onClick={() => { dismissNotice(notice.id); requestOpenSync(link.openSync) }}>
      {link.label}
    </Button>
  )
}

/** Small pop-ups at the bottom right. Each stays until closed or followed. */
export function NoticeStack() {
  const list = useNotices()
  if (list.length === 0) return null
  return (
    <section className="notice-stack" aria-label="Notifications">
      {list.map((notice) => (
        <div key={notice.id} className={`notice-pop is-${notice.kind}`} role={notice.kind === 'bad' ? 'alert' : 'status'}>
          <p className="notice-pop-text">{notice.message}</p>
          <div className="notice-pop-actions">
            <NoticeLinkView notice={notice} />
            <Button variant="secondary" type="button" onClick={() => dismissNotice(notice.id)}>Close</Button>
          </div>
        </div>
      ))}
    </section>
  )
}

/** The newest run-log or Connector notice, under the menu. */
export function NoticeBanner() {
  const latest = useNotices().filter((notice) => notice.live).at(-1)
  if (!latest) return null
  return (
    <SaveAlert kind={latest.kind === 'bad' ? 'bad' : 'ok'}>
      {latest.message} <NoticeLinkView notice={latest} />
      <Button variant="secondary" type="button" onClick={() => dismissNotice(latest.id)}>Close</Button>
    </SaveAlert>
  )
}
