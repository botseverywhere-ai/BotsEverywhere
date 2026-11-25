import { inflateRawSync } from 'node:zlib'

/** A backup is a few hundred small text files. These stop a zip made to fill the memory when it is unpacked. */
export const ZIP_LIMIT = { entries: 10_000, bytes: 50 * 1024 * 1024 }

export function unzipStore(body: Buffer, limit: { entries: number; bytes: number } = ZIP_LIMIT): { name: string; data: Buffer }[] {
  let eocd = -1
  const min = Math.max(0, body.length - 22 - 65535)
  for (let i = body.length - 22; i >= min; i -= 1) {
    if (body.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Zip is missing its directory.')
  const count = body.readUInt16LE(eocd + 8)
  if (count > limit.entries) throw new Error('Zip has too many files.')
  let cursor = body.readUInt32LE(eocd + 16)
  // Bytes still allowed once unpacked. Names may share the same packed data, so every file counts.
  let left = limit.bytes
  const files: { name: string; data: Buffer }[] = []
  for (let n = 0; n < count; n += 1) {
    if (cursor + 46 > body.length || body.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Zip directory is unreadable.')
    const method = body.readUInt16LE(cursor + 10)
    const compSize = body.readUInt32LE(cursor + 20)
    const nameLen = body.readUInt16LE(cursor + 28)
    const extraLen = body.readUInt16LE(cursor + 30)
    const commentLen = body.readUInt16LE(cursor + 32)
    const localOff = body.readUInt32LE(cursor + 42)
    const name = body.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8').replace(/\\/g, '/').replace(/^\/+/, '')
    cursor += 46 + nameLen + extraLen + commentLen
    if (!name || name.endsWith('/')) continue
    if (name.split('/').includes('..')) throw new Error('Zip entry leaves the archive.')
    if (localOff + 30 > body.length || body.readUInt32LE(localOff) !== 0x04034b50) throw new Error('Zip entry is unreadable.')
    const localNameLen = body.readUInt16LE(localOff + 26)
    const localExtraLen = body.readUInt16LE(localOff + 28)
    const start = localOff + 30 + localNameLen + localExtraLen
    const compressed = body.subarray(start, start + compSize)
    let data: Buffer
    if (method === 0) data = Buffer.from(compressed)
    else if (method === 8) data = inflate(compressed, left)
    else throw new Error(`Zip method ${method} is not supported.`)
    left -= data.length
    if (left < 0) throw new Error(TOO_LARGE)
    files.push({ name, data })
  }
  return files
}

const TOO_LARGE = 'Zip is too large when unpacked.'

/** Unpacks one file and stops as soon as it passes the bytes still allowed, before the memory is used. */
function inflate(packed: Buffer, left: number): Buffer {
  try {
    return inflateRawSync(packed, { maxOutputLength: Math.max(1, left) })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new Error(TOO_LARGE)
    throw error
  }
}

export function zipStore(files: { name: string; data: Buffer }[], when = new Date()): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  const stamp = dosDateTime(when)
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, file.data)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(stamp.time, 12)
    cen.writeUInt16LE(stamp.date, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(file.data.length, 20)
    cen.writeUInt32LE(file.data.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(offset, 42)
    central.push(cen, name)
    offset += 30 + name.length + file.data.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, end])
}

function dosDateTime(when: Date): { time: number; date: number } {
  const year = Math.max(when.getFullYear(), 1980) - 1980
  const date = (year << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2)
  return { time, date }
}

function crc32(data: Buffer): number {
  const table = crcTable()
  let crc = 0xffffffff
  for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!
  return (crc ^ 0xffffffff) >>> 0
}

let table: Uint32Array | null = null
function crcTable(): Uint32Array {
  if (table) return table
  table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}
