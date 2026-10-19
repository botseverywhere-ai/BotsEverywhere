import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** AES-256-GCM under SHA-256(ownerToken). The key is not stored. */
export function sealSecret(ownerToken: string, secret: string): string {
  const key = createHash('sha256').update(ownerToken).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function openSecret(ownerToken: string, sealed: string): string | null {
  try {
    const key = createHash('sha256').update(ownerToken).digest()
    const buf = Buffer.from(sealed, 'base64url')
    if (buf.length < 12 + 16 + 1) return null
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const data = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

export function hashOtp(pepper: string, email: string, code: string): string {
  return sha256(`${pepper}\n${email}\n${code}`)
}

export function randomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function newId(): string {
  return crypto.randomUUID()
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) return null
  return email
}

export function clip(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!allowEmpty && text.length === 0) return null
  if (text.length > max) return null
  return text
}
