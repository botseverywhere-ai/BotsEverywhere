import { relative } from 'node:path'
import type { Plugin } from 'vite'

/**
 * The Connector, the bots, and the writer rewrite files under orgs/ while the app runs. Org pages read them live from
 * the writer, so such a change only marks the bundled copy stale for the next page load. Sent as a hot update, every
 * Connector run re-ran the requests of each open page at once and queued them on the writer for seconds.
 */
export function quietOrgFiles(): Plugin {
  let root = process.cwd()
  return {
    name: 'quiet-org-files',
    apply: 'serve',
    configResolved(config) {
      root = config.root
    },
    hotUpdate: {
      // After the glob plugin, which adds the importers of a new or deleted file.
      order: 'post',
      handler({ file, modules }) {
        if (!isQuietOrgFile(root, file)) return
        for (const mod of modules) this.environment.moduleGraph.invalidateModule(mod)
        return []
      },
    },
  }
}

/** Any file under orgs/ except org.md, which names the organizations and changes only when a person does something. */
export function isQuietOrgFile(root: string, file: string): boolean {
  const path = relative(root, file).replace(/\\/g, '/')
  return path.startsWith('orgs/') && !path.endsWith('/org.md')
}
