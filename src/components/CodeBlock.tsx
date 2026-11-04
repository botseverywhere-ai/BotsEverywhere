import { createElement, useEffect, useState, type ReactNode } from 'react'

const COPY_RESET_MS = 2000

export function CodeBlock({ children, label = 'Terminal' }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), COPY_RESET_MS)
    return () => window.clearTimeout(id)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(children)
    } catch {
      return
    }
    setCopied(true)
  }

  return createElement(
    'div',
    { className: 'code-block' },
    createElement(
      'div',
      { className: 'code-block-bar' },
      createElement('span', { className: 'code-block-label' }, terminalIcon(), label),
      createElement(
        'button',
        { type: 'button', className: 'code-block-copy', onClick: () => void copy() },
        copied ? checkIcon() : copyIcon(),
        copied ? 'Copied' : 'Copy',
      ),
    ),
    createElement('pre', null, children),
  )
}

function terminalIcon(): ReactNode {
  return createElement(
    'svg',
    iconProps(),
    createElement('polyline', { points: '4 17 10 11 4 5' }),
    createElement('line', { x1: '12', x2: '20', y1: '19', y2: '19' }),
  )
}

function copyIcon(): ReactNode {
  return createElement(
    'svg',
    iconProps(),
    createElement('rect', { x: '8', y: '8', width: '13', height: '13', rx: '2' }),
    createElement('path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }),
  )
}

function checkIcon(): ReactNode {
  return createElement(
    'svg',
    iconProps(),
    createElement('path', { d: 'M20 6 9 17l-5-5' }),
  )
}

function iconProps() {
  return {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
}
