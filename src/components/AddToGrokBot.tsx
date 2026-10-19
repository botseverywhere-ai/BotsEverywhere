import { Button } from './Button'
/** Shown only when a real Grok Bot share URL is set. Do not invent one. */
export function AddToGrokBot({
  sparkle = false,
  className,
  href,
}: {
  sparkle?: boolean
  className?: string
  href?: string
}) {
  if (!href) return null
  return (
    <Button variant="primary" className={className} href={href} target="_blank" rel="noreferrer">
      {sparkle ? '✨ Add to Grok Bot' : 'Add to Grok Bot'}
    </Button>
  )
}
