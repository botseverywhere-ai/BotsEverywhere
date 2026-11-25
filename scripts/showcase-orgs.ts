import { relative } from 'node:path'
import type { Plugin } from 'vite'
import { orgFolders } from './quiet-org-files.ts'

/**
 * The showcase build is the public site, and the organizations under orgs/ are private. In showcase mode every
 * import.meta.glob over orgs/ gives an empty record, so no file there is read, and a build that still holds a file
 * from orgs/ stops. The local build is left alone: an organization can serve its own built copy.
 */
export function showcaseWithoutOrgs(): Plugin {
  let showcase = false
  let building = false
  let folders = orgFolders(process.cwd())
  return {
    name: 'showcase-without-orgs',
    // Before the glob plugin reads the patterns.
    enforce: 'pre',
    configResolved(config) {
      showcase = config.env.VITE_APP_MODE === 'showcase'
      building = config.command === 'build'
      folders = orgFolders(config.root)
    },
    transform(code) {
      if (!showcase || !code.includes('import.meta.glob')) return null
      const out = withoutOrgGlobs(code)
      return out === code ? null : { code: out, map: null }
    },
    buildEnd() {
      if (!showcase || !building) return
      const found = orgFilesIn(this.getModuleIds(), folders)
      if (found.length) {
        this.error(`This is the showcase build, the public site, and it would publish ${found.length} ${found.length === 1 ? 'file' : 'files'} from orgs/, starting with ${found[0]}. Organizations are private, so nothing was built. Something imports orgs/ outside import.meta.glob: keep it out of showcase mode.`)
      }
    },
  }
}

// A glob call whose first pattern has orgs/ as a folder: '../../orgs/*/org.md', or the same inside a list.
const ORG_GLOB = /import\.meta\.glob(?=\(\s*\[?\s*['"`](?:[^'"`]*\/)?orgs\/)/g

/** The source with each glob over orgs/ turned into a call that takes the same arguments and gives an empty record. */
export function withoutOrgGlobs(code: string): string {
  return code.replace(ORG_GLOB, '((..._patterns) => ({}))')
}

/** The files under an orgs folder among a bundle's module ids, as orgs/<path>. An id may end in a query such as ?raw. */
export function orgFilesIn(ids: Iterable<string>, folders: string[]): string[] {
  const found = new Set<string>()
  for (const id of ids) {
    if (id.startsWith('\0')) continue
    const file = id.replace(/[?#].*$/, '').replace(/\\/g, '/')
    for (const folder of folders) {
      const path = relative(folder.replace(/\\/g, '/'), file).replace(/\\/g, '/')
      if (path !== '' && path !== '..' && !path.startsWith('../') && !path.startsWith('/') && !/^[A-Za-z]:/.test(path)) found.add(`orgs/${path}`)
    }
  }
  return [...found].sort()
}
