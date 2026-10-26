import { useState, type ReactNode } from 'react'
import { grokBotsPrompt, localTimeZone } from '../content/grok-bots-prompt'
import { CopyPromptButton } from '../directory/prompt-actions'

/** Paste a prompt, then import the file it brings back. Option 1 by default; Option 2 passes its own prompt for any AI. */
export function GrokBotsPrompt({
  importAction,
  children,
  prompt: given,
  pasteTitle = 'Step 1. Paste this prompt into Grok Bot',
  importTitle = 'Step 2. Import the Grok Bot .json file',
  copyActions,
}: {
  importAction?: ReactNode
  children?: ReactNode
  prompt?: string
  pasteTitle?: string
  importTitle?: string
  /** Buttons beside Copy prompt, such as the template download. */
  copyActions?: ReactNode
}) {
  const [notice, setNotice] = useState('')
  // Times in the file come back in this computer's own time zone.
  const prompt = given ?? grokBotsPrompt(localTimeZone())
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
