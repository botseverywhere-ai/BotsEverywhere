/**
 * Where this project lives on GitHub. The home page, Docs, the footer, and the showcase banner link here.
 * VITE_REPO_URL overrides it for a fork; the default is the project's own repository.
 */
export const DEFAULT_REPO_URL = 'https://github.com/botseverywhere-ai/botseverywhere'

export const REPO_URL: string = (import.meta.env?.VITE_REPO_URL || DEFAULT_REPO_URL).replace(/\/+$/, '')
