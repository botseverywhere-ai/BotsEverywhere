import { useState, type ReactNode } from 'react'
import { GROK_BOTS_PROMPT } from '../content/grok-bots-prompt'
import { CopyPromptButton } from '../directory/prompt-actions'

export function GrokBotsPrompt({ importAction, children }: { importAction?: ReactNode; children?: ReactNode }) {
  const [notice, setNotice] = useState('')
  return (
    <div className="grok-steps">
      <section className="grok-step">
        <h3>Step 1. Paste this prompt into Grok Bot</h3>
        <pre className="dir-prompt">{GROK_BOTS_PROMPT}</pre>
        <div className="dir-actions">
          <CopyPromptButton text={GROK_BOTS_PROMPT} onCopied={setNotice} />
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
