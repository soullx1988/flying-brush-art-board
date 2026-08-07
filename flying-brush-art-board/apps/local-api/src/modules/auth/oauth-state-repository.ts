import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import type { LocalDatabase } from '../../db/schema.js'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

const DEFAULT_STATE_SECRET = 'infinite-board-test-only-state-secret-32'

function stateCipherKey(secret: string): Buffer {
  return scryptSync(secret, 'infinite-board/oauth-state/v1', 32)
}

export function isSafeReturnTo(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') && !value.includes('\\')
}

function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.pathname === '/auth/feishu/callback'
      && !url.search
      && !url.hash
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

function encryptVerifier(verifier: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', stateCipherKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(verifier, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
}

function decryptVerifier(value: string, secret: string): string | undefined {
  const [version, ivValue, ciphertextValue, tagValue] = value.split('.')
  if (version !== 'v1' || !ivValue || !ciphertextValue || !tagValue) return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', stateCipherKey(secret), Buffer.from(ivValue, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return undefined
  }
}

export class OAuthStateRepository {
  constructor(
    private readonly db: LocalDatabase,
    private readonly now = () => new Date(),
    private readonly secret = DEFAULT_STATE_SECRET,
  ) {}

  create(state: string, verifier: string, returnTo: string, redirectUri: string): void {
    if (!isSafeReturnTo(returnTo)) throw new Error('Invalid returnTo')
    if (!isSafeRedirectUri(redirectUri)) throw new Error('Invalid redirectUri')
    const now = this.now()
    this.db.prepare('INSERT INTO oauth_states(state_hash,verifier_ciphertext,return_to,redirect_uri,expires_at,created_at) VALUES (?,?,?,?,?,?)')
      .run(hash(state), encryptVerifier(verifier, this.secret), returnTo, redirectUri, new Date(now.getTime() + 600_000).toISOString(), now.toISOString())
  }

  consume(state: string): { verifier: string; returnTo: string; redirectUri: string } | undefined {
    const stateHash = hash(state)
    const row = this.db.prepare('SELECT verifier_ciphertext, return_to, redirect_uri, expires_at FROM oauth_states WHERE state_hash=?').get(stateHash) as { verifier_ciphertext: string; return_to: string; redirect_uri: string | null; expires_at: string } | undefined
    this.db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(stateHash)
    if (!row || new Date(row.expires_at) <= this.now()) return undefined
    const verifier = decryptVerifier(row.verifier_ciphertext, this.secret)
    return verifier && row.redirect_uri && isSafeRedirectUri(row.redirect_uri)
      ? { verifier, returnTo: row.return_to, redirectUri: row.redirect_uri }
      : undefined
  }
}
