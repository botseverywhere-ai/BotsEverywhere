export function Toast({ message, className = '' }: { message: string | null; className?: string }) {
  const shown = message ? 'toast show' : 'toast'
  return (
    <div className={className ? `${shown} ${className}` : shown} role="status" aria-live="polite">
      {message}
    </div>
  )
}
