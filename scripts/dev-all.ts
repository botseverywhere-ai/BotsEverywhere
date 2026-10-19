import { spawn, type ChildProcess } from 'node:child_process'
import { nextFreePort, portFromListenLine, WEB_PORT } from './dev-ports.ts'

const writer = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  stdio: ['inherit', 'pipe', 'inherit'],
  env: process.env,
})

const writerPort = await readWriterPort(writer)
let sitePort = await nextFreePort(Number(process.env.WEB_PORT) || WEB_PORT)
if (sitePort === writerPort) sitePort = await nextFreePort(writerPort + 1)

const site = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1',
  '--port', String(sitePort),
  '--strictPort',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WRITER_PORT: String(writerPort),
    VITE_WRITER_PORT: String(writerPort),
    WEB_PORT: String(sitePort),
  },
})

console.info(`Writer http://127.0.0.1:${writerPort}`)
console.info(`Site http://127.0.0.1:${sitePort}`)

const children = [writer, site]
function stop() {
  for (const child of children) child.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await new Promise((resolve) => {
  for (const child of children) child.on('exit', resolve)
})

function readWriterPort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The file writer did not print a listen URL.')), 20000)
    let buffer = ''
    let settled = false
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      process.stdout.write(chunk)
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const port = portFromListenLine(line)
        if (port && !settled) {
          settled = true
          clearTimeout(timer)
          resolve(port)
        }
        newline = buffer.indexOf('\n')
      }
    })
    child.on('exit', (code) => {
      if (settled) return
      clearTimeout(timer)
      reject(new Error(`The file writer exited (${code ?? 'signal'}) before it was listening.`))
    })
  })
}
