export function formatLogTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const clock = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
  return `${clock} (${zone})`
}
