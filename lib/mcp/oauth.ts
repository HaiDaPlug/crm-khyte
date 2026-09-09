import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Database } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { SCOPES, config, hashToken, pkceChallenge, randomToken, secureEqual } from './security'

export const authorizationSchema = z.strictObject({
  response_type: z.literal('code'), client_id: z.string().max(200), redirect_uri: z.url().max(2000),
  state: z.string().min(1).max(2000), resource: z.url(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'),
  scope: z.string().max(300),
})
export type Authorization = z.infer<typeof authorizationSchema>

export function validateAuthorization(raw: unknown): Authorization {
  const a = authorizationSchema.parse(raw), c = config()
  if (a.client_id !== c.clientId || !c.redirects.includes(a.redirect_uri) || a.resource !== c.resource) {
    throw new CrmError('invalid_request', 'Unrecognized client, callback or resource. Check the ChatGPT connection settings.')
  }
  const scopes = a.scope.split(' ').filter(Boolean)
  if (!scopes.includes('crm:read') || scopes.some(s => !SCOPES.includes(s as typeof SCOPES[number]))) throw new CrmError('invalid_scope', 'Request crm:read and only the supported CRM scopes.')
  return { ...a, scope: [...new Set(scopes)].sort().join(' ') }
}

export async function issueCode(db: Database, request: Authorization) {
  const a = validateAuthorization(request), code = randomToken()
  await db.query('delete from crm_oauth_codes where expires_at < now()')
  await db.query(`insert into crm_oauth_codes (code_hash, client_id, redirect_uri, challenge, scopes, resource, expires_at)
    values ($1,$2,$3,$4,$5::text[],$6,now() + interval '5 minutes')`,
    [hashToken(code), a.client_id, a.redirect_uri, a.code_challenge, a.scope.split(' '), a.resource])
  const callback = new URL(a.redirect_uri)
  callback.searchParams.set('code', code); callback.searchParams.set('state', a.state); callback.searchParams.set('iss', config().origin)
  return callback.toString()
}

function authenticateClient(form: URLSearchParams) {
  const c = config()
  if (form.get('client_id') !== c.clientId || !secureEqual(form.get('client_secret') ?? '', c.clientSecret)) {
    throw new CrmError('invalid_client', 'Invalid OAuth client credentials.')
  }
  return c
}

export async function exchangeToken(db: Database, form: URLSearchParams) {
  const c = authenticateClient(form)
  if (form.get('resource') !== c.resource) throw new CrmError('invalid_target', 'The resource does not match this CRM MCP server.')
  const access = randomToken(), refresh = randomToken()
  return db.transaction(async tx => {
    let connectionId: string, scopes: string[]
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? '', verifier = form.get('code_verifier') ?? ''
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new CrmError('invalid_grant', 'Invalid PKCE verifier.')
      const [row] = await tx.query<{ client_id: string; redirect_uri: string; challenge: string; scopes: string[]; resource: string }>(
        'select client_id, redirect_uri, challenge, scopes, resource from crm_oauth_codes where code_hash = $1 and expires_at > now() for update', [hashToken(code)])
      if (!row || row.client_id !== c.clientId || row.redirect_uri !== form.get('redirect_uri') || row.resource !== c.resource || !secureEqual(row.challenge, pkceChallenge(verifier))) {
        throw new CrmError('invalid_grant', 'Invalid or expired authorization code.')
      }
      await tx.query('delete from crm_oauth_codes where code_hash = $1', [hashToken(code)])
      connectionId = randomUUID(); scopes = row.scopes
      await tx.query(`insert into crm_oauth_connections (id, client_id, access_hash, refresh_hash, scopes, access_expires_at, refresh_expires_at)
        values ($1,$2,$3,$4,$5::text[],now() + interval '1 hour',now() + interval '30 days')`, [connectionId, c.clientId, hashToken(access), hashToken(refresh), scopes])
    } else if (form.get('grant_type') === 'refresh_token') {
      const [row] = await tx.query<{ id: string; scopes: string[] }>(`select id, scopes from crm_oauth_connections
        where refresh_hash = $1 and client_id = $2 and revoked_at is null and refresh_expires_at > now() for update`, [hashToken(form.get('refresh_token') ?? ''), c.clientId])
      if (!row) throw new CrmError('invalid_grant', 'The connection expired or was revoked. Connect again.')
      connectionId = row.id; scopes = row.scopes
      if (form.has('scope') && form.get('scope') !== scopes.join(' ')) throw new CrmError('invalid_scope', 'Reconnect to change permissions.')
      // Rotate both credentials; the original refresh expiry bounds the connection lifetime.
      await tx.query(`update crm_oauth_connections set access_hash = $1, refresh_hash = $2, access_expires_at = now() + interval '1 hour' where id = $3`,
        [hashToken(access), hashToken(refresh), connectionId])
    } else throw new CrmError('unsupported_grant_type', 'Use authorization_code or refresh_token.')
    return { access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh, scope: scopes.join(' ') }
  })
}

export function readBearerToken(header: string | null) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? '')?.[1]
  if (!token) throw new CrmError('unauthorized', 'Connect Khyte CRM before using its tools.')
  return token
}

export async function authenticateBearer(db: Database, header: string | null) {
  const token = readBearerToken(header)
  const [row] = await db.query<{ id: string; scopes: string[] }>(`select id, scopes from crm_oauth_connections
    where access_hash = $1 and client_id = $2 and revoked_at is null and access_expires_at > now() and refresh_expires_at > now()`, [hashToken(token), config().clientId])
  if (!row) throw new CrmError('unauthorized', 'The CRM connection expired or was revoked. Connect again.')
  return { connectionId: row.id, scopes: row.scopes }
}

export async function revokeToken(db: Database, form: URLSearchParams) {
  const c = authenticateClient(form), hash = hashToken(form.get('token') ?? '')
  await db.query('update crm_oauth_connections set revoked_at = now() where client_id = $1 and (access_hash = $2 or refresh_hash = $2)', [c.clientId, hash])
}

export function authorizationMetadata() {
  const c = config()
  return { issuer: c.origin, authorization_endpoint: `${c.origin}/oauth/authorize`, token_endpoint: `${c.origin}/oauth/token`, revocation_endpoint: `${c.origin}/oauth/revoke`,
    scopes_supported: SCOPES, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post'], revocation_endpoint_auth_methods_supported: ['client_secret_post'],
    code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true }
}

export function resourceMetadata() {
  const c = config()
  return { resource: c.resource, authorization_servers: [c.origin], scopes_supported: SCOPES, bearer_methods_supported: ['header'], resource_name: 'Khyte CRM' }
}
