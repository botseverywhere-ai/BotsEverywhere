import { createElement } from 'react'
import { Button } from './Button'
import type { AppMode } from '../mode'
import { SHOWCASE_NOTICE } from '../content/showcase-notice'
import { REPO_URL } from '../repo-url'

const github = REPO_URL

export function ShowcaseNotice({ mode }: { mode: AppMode }) {
  if (mode !== 'showcase') return null
  return createElement(
    'div',
    { className: 'showcase-notice', 'data-testid': 'showcase-notice', role: 'status' },
    createElement('p', null, SHOWCASE_NOTICE),
    createElement(
      'div',
      { className: 'showcase-notice-actions' },
      createElement(Button, { variant: 'primary', href: github }, 'Get it on GitHub'),
      createElement('a', { href: '#docs' }, 'How saving works'),
    ),
  )
}
