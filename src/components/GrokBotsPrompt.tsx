import { useState, type ReactNode } from 'react'
import { grokBotsPrompt, localTimeZone } from '../content/grok-bots-prompt'
import { CopyPromptButton } from '../directory/prompt-actions'

export function GrokBotsPrompt({ importAction, children }: { importAction?: ReactNode; children?: ReactNode }) {
  const [notice, setNotice] = useState('')
  // Times in the file come back in this computer's own time zone.
  const prompt = grokBotsPrompt(localTimeZone())
  return (
    <div className="grok-steps">
      <section className="grok-step">
        <h3>Step 1. Paste this prompt into Grok Bot</h3>
        <pre className="dir-prompt">{prompt}</pre>
        <div className="dir-actions">
          <CopyPromptButton text={prompt} onCopied={setNotice} />
        </div>
        {notice ? <p className="toast show" role="status">{notice}</p> : null}
      </section>
      <section className="grok-step">
        <h3>Step 2. Import the Grok Bot .json file</h3>
        {importAction ? <div className="dir-actions">{importAction}</div> : null}
        {children}
      </section>
    </div>
  )
}
