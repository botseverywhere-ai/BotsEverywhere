import { createServer } from 'node:net'

export const WEB_PORT = 5199
export const WRITER_PORT = 8787

/** First port at or after `start` that this machine can bind on 127.0.0.1. */
export function nextFreePort(start: number): Promise<number> {
  const port = normalizePort(start, WEB_PORT)
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', () => {
      server.close()
      resolve(nextFreePort(port + 1))
    })
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const bound = typeof address === 'object' && address ? address.port : port
      server.close((error) => (error ? reject(error) : resolve(bound)))
    })
  })
}

export function writerOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const port = normalizePort(Number(env.WRITER_PORT), WRITER_PORT)
  return `http://127.0.0.1:${port}`
}

export function webPort(env: NodeJS.ProcessEnv = process.env): number {
  return normalizePort(Number(env.WEB_PORT), WEB_PORT)
}

/** Pulls the port out of the writer's listen line. */
export function portFromListenLine(line: string): number | null {
  const match = /Template file API listening on http:\/\/(?:127\.0\.0\.1|\[::1\]):(\d+)/.exec(line)
  if (!match) return null
  const port = Number(match[1])
  return Number.isInteger(port) && port > 0 ? port : null
}

function normalizePort(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 65535) return fallback
  return value
}
