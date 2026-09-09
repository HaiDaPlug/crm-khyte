import 'server-only'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { CrmError } from '@/lib/crm/errors'
import { fingerprint } from '@/lib/crm/service'

export const SCOPES = ['crm:read', 'crm:outreach:write', 'crm:leads:write', 'crm:tasks:write'] as const
export const ACTION_SCOPES = { create_lead: 'crm:leads:write', log_outreach: 'crm:outreach:write', create_task: 'crm:tasks:write', assign_task: 'crm:tasks:write' } as const

export function config() {
  const raw = process.env.MCP_PUBLIC_URL
  const secret = process.env.MCP_SECRET
  const clientId = process.env.MCP_CLIENT_ID
  const clientSecret = process.env.MCP_CLIENT_SECRET
  const redirects = process.env.MCP_REDIRECT_URIS?.split(',').map(s => s.trim()).filter(Boolean)
  if (!raw || !secret || secret.length < 32 || !clientId || !clientSecret || clientSecret.length < 32 || !redirects?.length) {
    throw new CrmError('not_configured', 'Remote MCP is not configured.')
  }
  const url = new URL(raw)
  const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || !['/', ''].includes(url.pathname)) {
    throw new CrmError('not_configured', 'MCP_PUBLIC_URL must be the canonical HTTPS origin, without a path.')
  }
  for (const value of redirects) {
    const redirect = new URL(value)
    if (redirect.hash || redirect.username || redirect.password || (redirect.protocol !== 'https:' && !(local && ['localhost', '127.0.0.1'].includes(redirect.hostname) && redirect.protocol === 'http:'))) {
      throw new CrmError('not_configured', 'OAuth callbacks must be exact HTTPS URLs.')
    }
  }
  return { origin: url.origin, resource: `${url.origin}/mcp`, secret, clientId, clientSecret, redirects }
}

export function secureEqual(a: string, b: string) {
  const x = createHash('sha256').update(a).digest(), y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

export const randomToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHmac('sha256', config().secret).update(token).digest('hex')
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export function signEnvelope(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hashToken(body)}`
}

export function readEnvelope(token: string): Record<string, unknown> {
  if (token.length > 20000) throw new CrmError('invalid_token', 'Invalid or expired verification token.')
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra || !secureEqual(signature, hashToken(body))) throw new CrmError('invalid_token', 'Invalid or expired verification token.')
  let value: Record<string, unknown>
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString()) } catch { throw new CrmError('invalid_token', 'Invalid verification token.') }
  if (!value || typeof value.expiresAt !== 'number' || value.expiresAt < Date.now()) throw new CrmError('expired_token', 'The preview or connection request expired. Prepare it again.')
  return value
}

export function previewToken(action: string, parameters: unknown, connectionId: string) {
  return signEnvelope({ purpose: 'preview', hash: fingerprint({ action, parameters }), connectionId, expiresAt: Date.now() + 15 * 60_000 })
}

export function verifyPreview(token: string, action: string, parameters: unknown, connectionId: string) {
  const value = readEnvelope(token)
  if (value.purpose !== 'preview' || value.connectionId !== connectionId || value.hash !== fingerprint({ action, parameters })) {
    throw new CrmError('preview_mismatch', 'Parameters differ from the preview. Prepare a new preview before saving.')
  }
}
