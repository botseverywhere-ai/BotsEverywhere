import { useState, type ReactNode } from 'react'
import { CopyPromptButton } from '../directory/prompt-actions'

/** Paste a prompt, then import the file it brings back. Option 2 passes its prompt for any AI and its own titles. */
export function GrokBotsPrompt({
  importAction,
  children,
  prompt,
  pasteTitle,
  importTitle,
  copyActions,
}: {
  importAction?: ReactNode
  children?: ReactNode
  prompt: string
  pasteTitle: string
  importTitle: string
  /** Buttons beside Copy prompt, such as the template download. */
  copyActions?: ReactNode
}) {
  const [notice, setNotice] = useState('')
  return (
    <div className="grok-steps">
      <section className="grok-step">
        <h3>{pasteTitle}</h3>
        <pre className="dir-prompt">{prompt}</pre>
        <div className="dir-actions">
          <CopyPromptButton text={prompt} onCopied={setNotice} />
          {copyActions}
        </div>
        {notice ? <p className="toast show" role="status">{notice}</p> : null}
      </section>
      <section className="grok-step">
        <h3>{importTitle}</h3>
        {importAction ? <div className="dir-actions">{importAction}</div> : null}
        {children}
      </section>
    </div>
  )
}
