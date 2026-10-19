export type SaveNotice = { kind: 'ok'; message: string } | { kind: 'bad'; message: string }

/** Green success text, or a red "Not saved:" / "Not imported:" line. */
export function saveNotice(ok: true, message: string): SaveNotice
export function saveNotice(ok: false, reason: string, failureLead?: string): SaveNotice
export function saveNotice(ok: boolean, text: string, failureLead = 'Not saved'): SaveNotice {
  if (ok) return { kind: 'ok', message: text }
  const reason = text.trim() || 'the file writer did not save.'
  const lead = `${failureLead}:`
  return { kind: 'bad', message: reason.startsWith(lead) ? reason : `${lead} ${reason}` }
}
