import { existsSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { readOrgDir } from '../server/src/template-server.ts'

const orgs = resolve(process.env.ORGS_DIR || 'orgs')
const roots: { id: string; dir: string }[] = []
if (existsSync(orgs)) {
  for (const name of readdirSync(orgs, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const dir = resolve(orgs, name.name)
    if (existsSync(resolve(dir, 'org.md')) || existsSync(resolve(dir, 'org.json'))) roots.push({ id: name.name, dir })
  }
}
const samples = resolve('samples')
if (existsSync(samples)) {
  for (const name of readdirSync(samples, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const dir = resolve(samples, name.name)
    if (existsSync(resolve(dir, 'org.json'))) roots.push({ id: basename(dir), dir })
  }
}

let failed = false
for (const root of roots) {
  const result = readOrgDir(root.dir, root.id)
  if (!result.ok) {
    failed = true
    for (const error of result.errors) console.error(error)
    continue
  }
  const links = result.bundle.seats.filter((seat) => seat.addToGrokBotUrl !== '')
  console.log(`${root.id}: ${result.bundle.seats.length} seats, ${links.length} Grok Bot links`)
}

if (failed) process.exit(1)
