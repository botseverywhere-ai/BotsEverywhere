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
