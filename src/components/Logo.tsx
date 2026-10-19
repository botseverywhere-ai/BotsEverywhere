/** Final mark: Org Bracket lockup. The wordmark is outlined in the SVG. */

export function Logo({ size = 'md', href = '/' }: { size?: 'md' | 'sm'; href?: string }) {
  const src = size === 'sm' ? '/mark-favicon-ink.svg' : '/lockup-ink.svg'
  return (
    <a className={size === 'sm' ? 'brand brand-sm' : 'brand'} href={href} aria-label="BotsEverywhere">
      <img src={src} alt="" />
    </a>
  )
}
