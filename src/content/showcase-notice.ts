import type { AppMode } from '../mode'

export const SHOWCASE_NOTICE =
  'Live preview, nothing here is saved. Download BotsEverywhere (open source) to save your own org. Your files are stored on your computer, in the orgs folder of your copy.'

/** Charts (org and work) and every sample page. */
export function showsShowcaseNotice(mode: AppMode, page: { sample?: boolean; view: string }): boolean {
  return mode === 'showcase' && (page.sample === true || page.view === 'org' || page.view === 'work')
}
