import { useState } from 'react'
import { Button } from './Button'
import { greyedLine, greyedOrgs } from './sync-copy'

/** A greyed seat's panel: its bot works for another organization, and these are the ways it can work here. */
export function GreyedSeatBox({
  bot,
  orgs,
  orgName,
  canMarkMain,
  onMove,
  onPublish,
  onRemove,
  onMainBot,
}: {
  bot: string
  /** Where the bot works now, by name. */
  orgs: string[]
  /** This organization, for the new bot's name. */
  orgName: string
  /** Only while no main bot is saved. */
  canMarkMain: boolean
  onMove: () => void
  onPublish: (name: string) => void
  onRemove: () => void
  onMainBot: () => void
}) {
  const [name, setName] = useState(`${bot} - ${orgName}`)
  const names = greyedOrgs(orgs)
  return (
    <section className="greyed-box" aria-label="Used in another organization">
      <p className="greyed-line"><strong>{greyedLine(bot, orgs)}</strong></p>
      <div className="greyed-choice">
        <Button variant="primary" type="button" onClick={onMove}>Move it here</Button>
        <p className="auth-note">Takes it out of {names} and makes it work here.</p>
      </div>
      <div className="greyed-choice">
        <label className="field-label">
          New name
          <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <Button variant="secondary" type="button" disabled={!name.trim()} onClick={() => onPublish(name.trim())}>Rename and publish in Grok Bot</Button>
        <p className="auth-note">A new bot with this name works here. {bot} stays in {names}.</p>
      </div>
      <div className="greyed-choice">
        <Button variant="secondary" type="button" onClick={onRemove}>Remove</Button>
        <p className="auth-note">Takes this seat off the chart. The bot stays in {names}.</p>
      </div>
      {canMarkMain ? (
        <div className="greyed-choice">
          <Button variant="secondary" type="button" onClick={onMainBot}>It's my main bot</Button>
          <p className="auth-note">Your main bot works in every organization.</p>
        </div>
      ) : null}
    </section>
  )
}
