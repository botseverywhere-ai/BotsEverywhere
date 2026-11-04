import { useState } from 'react'
import { Button } from './Button'
import { MAIN_BOT_LINE, MAIN_BOT_QUESTION } from './sync-copy'

const LATER_KEY = 'be-main-bot-later:'

function readLater(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeLater(key: string) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // It still hides for this page; it asks again on the next load.
  }
}

/**
 * Asks above the org chart which greyed bot is the owner's main bot, with the one most seats report to picked first.
 * Not now hides it for this organization in this browser. Once a main bot is saved there are no choices, anywhere.
 */
export function MainBotBar({ slug, choices, onSave }: { slug: string; choices: { id: string; name: string }[]; onSave: (id: string) => void }) {
  const key = LATER_KEY + slug
  const [later, setLater] = useState(() => readLater(key))
  const [picked, setPicked] = useState('')
  if (later || !choices.length) return null
  const chosen = choices.some((choice) => choice.id === picked) ? picked : choices[0]!.id
  return (
    <section className="main-bot-bar" aria-label="Main bot">
      <p className="main-bot-bar-text"><strong>{MAIN_BOT_QUESTION}</strong> {MAIN_BOT_LINE}</p>
      <div className="main-bot-bar-actions">
        <select className="text-input" aria-label="Main bot" value={chosen} onChange={(event) => setPicked(event.target.value)}>
          {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
        </select>
        <Button variant="primary" type="button" onClick={() => onSave(chosen)}>It's my main bot</Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            writeLater(key)
            setLater(true)
          }}
        >Not now</Button>
      </div>
    </section>
  )
}
