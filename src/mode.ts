export type AppMode = 'template' | 'showcase' | 'sqlite'

export const APP_MODE: AppMode = readMode(import.meta.env.VITE_APP_MODE)

export const canEditFiles = import.meta.env.DEV && APP_MODE === 'template'

function readMode(value: unknown): AppMode {
  if (value === 'showcase' || value === 'sqlite') return value
  return 'template'
}
