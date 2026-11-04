import { createElement, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

type Shared = {
  variant?: ButtonVariant
  /** Back control. The ghost variant draws the left arrow. */
  back?: boolean
  className?: string
  children?: ReactNode
}

type AsButton = Shared & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
  href?: undefined
}

type AsLink = Shared & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'> & {
  href: string
}

function backArrow() {
  return createElement(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true },
    createElement('path', {
      d: 'M10 3 5 8l5 5',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

export function Button({ variant = 'primary', back = false, className, children, ...props }: AsButton | AsLink) {
  const classes = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ')
  const body = back ? [backArrow(), children] : children

  if ('href' in props && props.href !== undefined) {
    const { href, ...rest } = props
    return createElement('a', { ...rest, className: classes, href }, body)
  }

  const { type = 'button', ...rest } = props as AsButton
  return createElement('button', { ...rest, className: classes, type }, body)
}
