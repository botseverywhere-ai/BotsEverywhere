const KEY = 'be-org-folder:'
export const FOLDER_EVENT = 'be-org-folder'

export function orgFolder(slug: string): string {
  const fallback = `orgs/${slug}`
  try {
    return localStorage.getItem(KEY + slug) || fallback
  } catch {
    return fallback
  }
}

export function rememberOrgFolder(slug: string, value: string) {
  try {
    localStorage.setItem(KEY + slug, value)
  } catch {
    // The folder still updates the prompt on this page.
  }
  window.dispatchEvent(new CustomEvent(FOLDER_EVENT, { detail: { slug, value } }))
}

/** Where the organization's process files sit, with the separator its own path uses. */
export function processesFolder(folder: string): string {
  const sep = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[\\/]+$/, '')}${sep}processes`
}

/** Where the organization's seat files sit, with the separator its own path uses. */
export function seatsFolder(folder: string): string {
  const sep = folder.includes('\\') ? '\\' : '/'
  return `${folder.replace(/[\\/]+$/, '')}${sep}seats`
}
