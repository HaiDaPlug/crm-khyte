import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Database } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { SCOPES, config, hashToken, pkceChallenge, randomToken, secureEqual } from './security'

/**
 * Who a bearer token acts as.
 *
 * A connection is approved by a logged-in person and carries that person and
 * their organization for its whole life: the consent page binds them into the
 * authorization code, the code hands them to the connection, and every tool
 * call reads them back from here. Nothing the client sends — not a parameter,
 * not a scope, not a header — can change which organization a token reaches.
 */
export type Principal = { connectionId: string; scopes: string[]; userId: string; organizationId: string }

// Unknown parameters are stripped, not rejected: RFC 6749 3.1 requires the
// authorization endpoint to ignore parameters it does not understand, and
// ChatGPT sends several of its own. A strict object refused the whole request
// instead, which surfaced only as the generic oauthError fallback.
export const authorizationSchema = z.object({
  response_type: z.literal('code'), client_id: z.string().max(200), redirect_uri: z.url().max(2000),
  state: z.string().min(1).max(2000),
  // Optional per RFC 8707 — MCP says clients SHOULD send it, not MUST. Absent
  // means this server's only resource; a value that disagrees is still refused.
  resource: z.url().optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'),
  scope: z.string().max(300),
})
/** `resource` is always filled in by validateAuthorization. */
export type Authorization = z.infer<typeof authorizationSchema> & { resource: string }

export function validateAuthorization(raw: unknown): Authorization {
  const c = config(), parsed = authorizationSchema.safeParse(raw)
  // Name the fields at fault. A ZodError is not a CrmError, so it used to fall
  // through to "Unable to complete the connection request." with nothing to act on.
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(i => i.path.join('.') || 'request'))]
    throw new CrmError('invalid_request', `Authorization request is missing or malformed: ${fields.join(', ')}.`)
  }
  const a: Authorization = { ...parsed.data, resource: parsed.data.resource ?? c.resource }
  if (a.client_id !== c.clientId || !c.redirects.includes(a.redirect_uri) || a.resource !== c.resource) {
    throw new CrmError('invalid_request', 'Unrecognized client, callback or resource. Check the ChatGPT connection settings.')
  }
  const scopes = a.scope.split(' ').filter(Boolean)
  if (!scopes.includes('crm:read') || scopes.some(s => !SCOPES.includes(s as typeof SCOPES[number]))) throw new CrmError('invalid_scope', 'Request crm:read and only the supported CRM scopes.')
  return { ...a, scope: [...new Set(scopes)].sort().join(' ') }
}

/**
 * Mints the authorization code the consent page redirects back with.
 *
 * `identity` is the person who clicked Anslut, as the consent route resolved
 * them from their session — the code is the only thing that carries that
 * identity from the browser to the token exchange, which has no session.
 */
export interface CodeIdentity {
  userId: string
  organizationId: string
  memberId: string
  /** organization_members.credential_generation as the consent route saw it. */
  credentialGeneration: string
}

export async function issueCode(db: Database, request: Authorization, identity: CodeIdentity) {
  const a = validateAuthorization(request), code = randomToken()
  await db.query('delete from crm_oauth_codes where expires_at < now()')
  await db.query(`insert into crm_oauth_codes (code_hash, client_id, redirect_uri, challenge, scopes, resource, user_id, organization_id, member_id, member_generation, expires_at)
    values ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,now() + interval '5 minutes')`,
    [hashToken(code), a.client_id, a.redirect_uri, a.code_challenge, a.scope.split(' '), a.resource,
      identity.userId, identity.organizationId, identity.memberId, identity.credentialGeneration])
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

// The membership join every credential check below shares. An active
// membership *under the generation the credential was minted with* is a
// condition of the token, not only of its issue: revokeMember revokes the
// connections it knows about, but a connection that outlives its membership
// by any other path — the members script, a manual update — must still be
// refused, and one minted before a revoke must stay dead after the same
// membership row is re-added or its password reset (both rotate the
// generation; see lib/org/members.ts). This is where all of that happens.
const ACTIVE_MEMBER_JOIN = "join organization_members m on m.id = c.member_id and m.organization_id = c.organization_id and m.user_id = c.user_id and m.status = 'active' and m.credential_generation = c.member_generation"

export async function exchangeToken(db: Database, form: URLSearchParams) {
  const c = authenticateClient(form)
  // Same RFC 8707 latitude as the authorization request: absent means this
  // server's only resource, a disagreeing value is refused.
  const target = form.get('resource')
  if (target !== null && target !== c.resource) throw new CrmError('invalid_target', 'The resource does not match this CRM MCP server.')
  const access = randomToken(), refresh = randomToken()
  return db.transaction(async tx => {
    let connectionId: string, scopes: string[]
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? '', verifier = form.get('code_verifier') ?? ''
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new CrmError('invalid_grant', 'Invalid PKCE verifier.')
      const [row] = await tx.query<{ client_id: string; redirect_uri: string; challenge: string; scopes: string[]; resource: string;
        user_id: string | null; organization_id: string | null; member_id: string | null; member_generation: string | null }>(
        `select client_id, redirect_uri, challenge, scopes, resource, user_id, organization_id, member_id, member_generation
         from crm_oauth_codes where code_hash = $1 and expires_at > now() for update`, [hashToken(code)])
      if (!row || row.client_id !== c.clientId || row.redirect_uri !== form.get('redirect_uri') || row.resource !== c.resource || !secureEqual(row.challenge, pkceChallenge(verifier))) {
        throw new CrmError('invalid_grant', 'Invalid or expired authorization code.')
      }
      await tx.query('delete from crm_oauth_codes where code_hash = $1', [hashToken(code)])
      // The identity columns are nullable (they were added to a live table),
      // so the check is here rather than trusted to the schema.
      if (!row.user_id || !row.organization_id || !row.member_id || !row.member_generation) {
        throw new CrmError('invalid_grant', 'The authorization code has no active member behind it. Log in and connect again.')
      }
      // The account lock orders this exchange against a revoke of the same
      // person (lib/org/members.ts takes the same lock): either the revoke
      // finished first and the membership below is gone or regenerated, or it
      // waits for this to commit and then revokes the connection it created.
      // Nothing can slip through between the check and the insert.
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`khyte:user:${row.user_id}`])
      // The membership must be active *and* still on the generation the code
      // was minted under. Someone revoked and re-added inside the five-minute
      // window is active again, but on a new generation — the code stays
      // dead, as it should. The throw rolls the deletion back, and the code
      // cannot succeed on a retry either.
      const [member] = await tx.query<{ id: string }>(
        `select id from organization_members
         where id = $1 and user_id = $2 and organization_id = $3 and status = 'active' and credential_generation = $4`,
        [row.member_id, row.user_id, row.organization_id, row.member_generation])
      if (!member) {
        throw new CrmError('invalid_grant', 'The authorization code has no active member behind it. Log in and connect again.')
      }
      connectionId = randomUUID(); scopes = row.scopes
      await tx.query(`insert into crm_oauth_connections (id, client_id, user_id, organization_id, member_id, member_generation, access_hash, refresh_hash, scopes, access_expires_at, refresh_expires_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],now() + interval '1 hour',now() + interval '30 days')`,
        [connectionId, c.clientId, row.user_id, row.organization_id, row.member_id, row.member_generation, hashToken(access), hashToken(refresh), scopes])
    } else if (form.get('grant_type') === 'refresh_token') {
      const [row] = await tx.query<{ id: string; scopes: string[] }>(`select c.id, c.scopes from crm_oauth_connections c ${ACTIVE_MEMBER_JOIN}
        where c.refresh_hash = $1 and c.client_id = $2 and c.revoked_at is null and c.refresh_expires_at > now() for update of c`, [hashToken(form.get('refresh_token') ?? ''), c.clientId])
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

export async function authenticateBearer(db: Database, header: string | null): Promise<Principal> {
  const token = readBearerToken(header)
  const [row] = await db.query<{ id: string; scopes: string[]; user_id: string; organization_id: string }>(
    `select c.id, c.scopes, c.user_id, c.organization_id from crm_oauth_connections c ${ACTIVE_MEMBER_JOIN}
    where c.access_hash = $1 and c.client_id = $2 and c.revoked_at is null and c.access_expires_at > now() and c.refresh_expires_at > now()`, [hashToken(token), config().clientId])
  if (!row) throw new CrmError('unauthorized', 'The CRM connection expired or was revoked. Connect again.')
  return { connectionId: row.id, scopes: row.scopes, userId: row.user_id, organizationId: row.organization_id }
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
