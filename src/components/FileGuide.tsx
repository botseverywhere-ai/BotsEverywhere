import { useEffect, useState } from 'react'
import type { FileGuide as Guide } from '../../server/src/file-guide.ts'
import { Button } from './Button'
import { FILE_GROUPS, FILE_ID_NOTE, FILE_NAMES, FILE_WHAT, fileFact } from './file-guide-copy'

const COPY_RESET_MS = 2000

/** Your files: where this organization sits on the computer and what each main file holds. It only tells; nothing here changes a file. */
export function FileGuide({ slug, name }: { slug: string; name: string }) {
  // The folder as last read, and when: the times below read against that moment.
  const [read, setRead] = useState<{ guide: Guide; at: number } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let stop = false
    let timer: number | undefined
    const load = () => {
      fetch(`/api/orgs/${slug}/files`)
        .then((response) => (response.ok ? (response.json() as Promise<Guide>) : null))
        .then((body) => {
          if (!stop && body) setRead({ guide: body, at: Date.now() })
        })
        .catch(() => undefined)
    }
    // A burst of writes from a bot or the Connector reads the folder once.
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 500)
    }
    load()
    const source = new EventSource(`/api/orgs/${slug}/live`)
    for (const kind of ['log', 'processes', 'org', 'grok']) source.addEventListener(kind, later)
    return () => {
      stop = true
      window.clearTimeout(timer)
      source.close()
    }
  }, [slug])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
    return () => window.clearTimeout(id)
  }, [copied])

  if (!read) return null
  const { guide, at } = read

  async function copy(path: string) {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      return
    }
    setCopied(true)
  }

  return (
    <section className="file-guide" aria-labelledby="file-guide-title">
      <h2 id="file-guide-title">Your files</h2>
      <p className="overview-note">This organization is a folder on your computer. These are its main files, and what writes each one.</p>
      <div className="file-guide-root">
        <strong className="file-guide-name">{name}</strong>
        <code>{guide.folder}</code>
        <Button variant="secondary" type="button" onClick={() => void copy(guide.folder)}>{copied ? 'Copied' : 'Copy path'}</Button>
      </div>
      <p className="overview-note">{FILE_ID_NOTE}</p>
      {FILE_GROUPS.map((group) => (
        <div className="file-guide-group" key={group.title}>
          <h3>{group.title}</h3>
          <dl>
            {group.keys.map((key) => {
              const row = guide.rows.find((item) => item.key === key)
              if (!row) return null
              return (
                <div className="file-guide-row" key={key}>
                  <dt><code title={row.path}>{FILE_NAMES[key]}</code></dt>
                  <dd>{FILE_WHAT[key]}</dd>
                  <dd className="file-guide-fact">{fileFact(row, at)}</dd>
                </div>
              )
            })}
          </dl>
        </div>
      ))}
    </section>
  )
}
