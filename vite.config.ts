import { spawnSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { webPort, writerOrigin } from './scripts/dev-ports.ts'

function contentIndexes(): Plugin {
  const generate = () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/generate-content-indexes.ts'], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Could not generate the directory index and sample cards.')
  }
  return {
    name: 'content-indexes',
    buildStart() {
      generate()
    },
    configureServer(server) {
      generate()
      const refresh = (file: string) => {
        if (file.includes('/directory/') || file.includes('/samples/')) generate()
      }
      server.watcher.on('add', refresh)
      server.watcher.on('change', refresh)
      server.watcher.on('unlink', refresh)
    },
  }
}

// Static demo, served from the root of botseverywhere.ai.
export default defineConfig({
  base: '/',
  plugins: [contentIndexes(), react()],
  server: {
    host: '127.0.0.1',
    port: webPort(),
    strictPort: true,
    proxy: {
      '/api': writerOrigin(),
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
})
