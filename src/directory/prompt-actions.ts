import { createElement } from 'react'
import { Button } from '../components/Button'
import { isGrokBotUrl } from '../../server/src/org-files.ts'

export async function copyPrompt(text: string, write: (value: string) => Promise<void>): Promise<string> {
  await write(text)
  return 'Prompt copied'
}

export function GrokBotLink({ url, label = 'Add to Grok Bot' }: { url: string | null; label?: string }) {
  if (!url || !isGrokBotUrl(url)) return null
  return createElement(
    Button,
    {
      variant: 'primary',
      className: 'dir-add',
      href: url,
      target: '_blank',
      rel: 'noopener',
      onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    },
    label,
  )
}

export function CopyPromptButton({ text, onCopied, label = 'Copy prompt' }: { text: string; onCopied: (message: string) => void; label?: string }) {
  return createElement(
    Button,
    {
      type: 'button',
      variant: 'primary',
      onClick: () => {
        void copyPrompt(text, (value) => navigator.clipboard.writeText(value))
          .then((message) => onCopied(message))
          .catch(() => onCopied('Could not copy the prompt'))
      },
    },
    label,
  )
}
