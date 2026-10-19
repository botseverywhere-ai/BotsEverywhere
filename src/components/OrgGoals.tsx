import { useState, type FormEvent } from 'react'
import { ApiError, api, type GoalRecord } from '../api'
import { MeterFill } from './MeterFill'
import { Button } from './Button'

export function OrgGoals({
  goals,
  onReload,
  onError,
}: {
  goals: GoalRecord[]
  onReload: () => Promise<void>
  onError: (message: string) => void
}) {
  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/api/owner/goals', { method: 'POST', body: { title, dueOn } })
      setTitle('')
      setDueOn('')
      await onReload()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not add the goal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="owner-goals" aria-labelledby="owner-goals-title">
      <h2 id="owner-goals-title">Goals</h2>
      {goals.length === 0 ? <p className="auth-note">No goals yet.</p> : null}
      <ul className="goal-list">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} onReload={onReload} onError={onError} />
        ))}
      </ul>
      <form className="card team-card goal-create" onSubmit={create}>
        <h3>New goal</h3>
        <label className="field-label" htmlFor="goal-title">
          Title
        </label>
        <input id="goal-title" className="text-input" value={title} maxLength={160} required onChange={(event) => setTitle(event.target.value)} />
        <label className="field-label" htmlFor="goal-due">
          Due date
        </label>
        <input id="goal-due" className="text-input" type="date" value={dueOn} required onChange={(event) => setDueOn(event.target.value)} />
        <Button variant="primary"  type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add goal'}
        </Button>
      </form>
    </section>
  )
}

function GoalCard({
  goal,
  onReload,
  onError,
}: {
  goal: GoalRecord
  onReload: () => Promise<void>
  onError: (message: string) => void
}) {
  const [title, setTitle] = useState(goal.title)
  const [dueOn, setDueOn] = useState(goal.dueOn)
  const [milestoneTitle, setMilestoneTitle] = useState('')
  const [milestoneDue, setMilestoneDue] = useState('')
  const [busy, setBusy] = useState('')
  const percent = goal.progress.total === 0 ? 0 : Math.round((goal.progress.done / goal.progress.total) * 100)

  async function saveGoal(event: FormEvent) {
    event.preventDefault()
    setBusy('goal')
    try {
      await api(`/api/owner/goals/${goal.id}`, { method: 'PATCH', body: { title, dueOn } })
      await onReload()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save the goal.')
    } finally {
      setBusy('')
    }
  }

  async function removeGoal() {
    setBusy('delete')
    try {
      await api(`/api/owner/goals/${goal.id}`, { method: 'DELETE' })
      await onReload()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not remove the goal.')
    } finally {
      setBusy('')
    }
  }

  async function addMilestone(event: FormEvent) {
    event.preventDefault()
    setBusy('add')
    try {
      await api(`/api/owner/goals/${goal.id}/milestones`, {
        method: 'POST',
        body: { title: milestoneTitle, dueOn: milestoneDue || null },
      })
      setMilestoneTitle('')
      setMilestoneDue('')
      await onReload()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not add the milestone.')
    } finally {
      setBusy('')
    }
  }

  async function toggle(id: string, done: boolean) {
    try {
      await api(`/api/owner/milestones/${id}`, { method: 'PATCH', body: { done } })
      await onReload()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not update the milestone.')
    }
  }

  async function saveMilestone(id: string, nextTitle: string, nextDue: string) {
    try {
      await api(`/api/owner/milestones/${id}`, {
        method: 'PATCH',
        body: { title: nextTitle, dueOn: nextDue || null },
      })
      await onReload()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save the milestone.')
    }
  }

  async function removeMilestone(id: string) {
    try {
      await api(`/api/owner/milestones/${id}`, { method: 'DELETE' })
      await onReload()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not remove the milestone.')
    }
  }

  return (
    <li className="card goal-card">
      <form onSubmit={saveGoal} className="goal-head">
        <label className="field-label" htmlFor={`goal-${goal.id}-title`}>
          Title
        </label>
        <input id={`goal-${goal.id}-title`} className="text-input" value={title} maxLength={160} required onChange={(event) => setTitle(event.target.value)} />
        <label className="field-label" htmlFor={`goal-${goal.id}-due`}>
          Due date
        </label>
        <input id={`goal-${goal.id}-due`} className="text-input" type="date" value={dueOn} required onChange={(event) => setDueOn(event.target.value)} />
        <div className="goal-actions">
          <Button variant="secondary"  type="submit" disabled={busy === 'goal'}>
            Save goal
          </Button>
          <Button variant="secondary"  type="button" disabled={busy === 'delete'} onClick={() => void removeGoal()}>
            Remove goal
          </Button>
        </div>
      </form>
      <p className="goal-progress">
        {goal.progress.done} of {goal.progress.total} milestones
      </p>
      <div className="progress" aria-hidden="true">
        <MeterFill percent={percent} />
      </div>
      <ul className="milestone-list">
        {goal.milestones.map((milestone) => (
          <MilestoneRow
            key={milestone.id}
            milestone={milestone}
            onToggle={(done) => void toggle(milestone.id, done)}
            onSave={(nextTitle, nextDue) => void saveMilestone(milestone.id, nextTitle, nextDue)}
            onRemove={() => void removeMilestone(milestone.id)}
          />
        ))}
      </ul>
      <form onSubmit={addMilestone} className="milestone-add">
        <label className="field-label" htmlFor={`ms-${goal.id}`}>
          New milestone
        </label>
        <input id={`ms-${goal.id}`} className="text-input" value={milestoneTitle} maxLength={160} required onChange={(event) => setMilestoneTitle(event.target.value)} />
        <label className="field-label" htmlFor={`ms-due-${goal.id}`}>
          Date, optional
        </label>
        <input id={`ms-due-${goal.id}`} className="text-input" type="date" value={milestoneDue} onChange={(event) => setMilestoneDue(event.target.value)} />
        <Button variant="secondary"  type="submit" disabled={busy === 'add'}>
          Add milestone
        </Button>
      </form>
    </li>
  )
}

function MilestoneRow({
  milestone,
  onToggle,
  onSave,
  onRemove,
}: {
  milestone: GoalRecord['milestones'][number]
  onToggle: (done: boolean) => void
  onSave: (title: string, dueOn: string) => void
  onRemove: () => void
}) {
  const [title, setTitle] = useState(milestone.title)
  const [dueOn, setDueOn] = useState(milestone.dueOn ?? '')

  return (
    <li className="milestone">
      <label className="milestone-done">
        <input type="checkbox" checked={milestone.done} onChange={(event) => onToggle(event.target.checked)} />
        <span className="sr-only">Done</span>
      </label>
      <input className="text-input" aria-label="Milestone title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
      <input className="text-input" aria-label="Milestone date" type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
      <Button variant="secondary"  type="button" onClick={() => onSave(title, dueOn)}>
        Save
      </Button>
      <Button variant="secondary"  type="button" onClick={onRemove}>
        Remove
      </Button>
    </li>
  )
}
