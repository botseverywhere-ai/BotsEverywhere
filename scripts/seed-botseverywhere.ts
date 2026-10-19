import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { openDatabase } from '../server/src/db.ts'
import { seedBotseverywhere } from '../server/src/seed-botseverywhere.ts'

const sqlitePath = resolve(process.env.SQLITE_PATH || 'data/botseverywhere.sqlite')
const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5199'
if (sqlitePath !== ':memory:') mkdirSync(dirname(sqlitePath), { recursive: true })

const sqlite = new Database(sqlitePath)
const db = openDatabase(sqlite)
const result = seedBotseverywhere(db, { origin })
sqlite.close()

if (!result.created) {
  console.log('botseverywhere already exists. The owner link was printed the first time this script ran and is not stored.')
} else {
  console.log(result.ownerUrl)
  console.log("Save this link. It's the only way in. It is not stored anywhere else.")
}
