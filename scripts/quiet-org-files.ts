import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * The Connector, the bots, and the writer rewrite files under orgs/ while the app runs. Org pages read them live from
 * the writer, so such a change only marks the bundled copy stale for the next page load. Sent as a hot update, every
 * Connector run re-ran the requests of each open page at once and queued them on the writer for seconds.
 */
export function quietOrgFiles(): Plugin {
  let folders = orgFolders(process.cwd())
  return {
    name: 'quiet-org-files',
    apply: 'serve',
    configResolved(config) {
      folders = orgFolders(config.root)
    },
    hotUpdate: {
      // After the glob plugin, which adds the importers of a new or deleted file.
      order: 'post',
      handler({ file, modules }) {
        if (!isQuietOrgFile(folders, file)) return
        for (const mod of modules) this.environment.moduleGraph.invalidateModule(mod)
        return []
      },
    },
  }
}

/** orgs/ in the app folder, and its real folder when orgs/ is a link: the watcher reports files by the real one. */
export function orgFolders(root: string): string[] {
  const folder = resolve(root, 'orgs')
  try {
    const real = realpathSync(folder)
    return real === folder ? [folder] : [folder, real]
  } catch {
    return [folder]
  }
}

/** Any file in an orgs folder except org.md, which names the organizations and changes only when a person does something. */
export function isQuietOrgFile(folders: string[], file: string): boolean {
  return folders.some((folder) => {
    const path = relative(folder, file).replace(/\\/g, '/')
    return path !== '' && !path.startsWith('../') && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !/^[^/]+\/org\.md$/.test(path)
  })
}
