import { cookies } from 'next/headers'
import { getAuthContext } from '@/lib/auth/context'
import { SESSION_COOKIE } from '@/lib/auth/session'
import { crmDatabase } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { renderConsentPage } from '@/lib/mcp/consent'
import { issueCode, validateAuthorization } from '@/lib/mcp/oauth'
import { config, hashToken, readEnvelope, signEnvelope } from '@/lib/mcp/security'
import { checkOrigin, oauthError, readBody } from '@/lib/mcp/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Who is approving, and the cookie that proves it.
 *
 * The full context, not the cookie-only check proxy.ts makes: the page names
 * the person the connection will act as, and the code it mints carries that
 * identity, so the session must resolve to an active membership here. The raw
 * cookie value is kept alongside because the consent envelope is pinned to
 * its hash — the identity says who, the hash says from which login.
 */
async function approver() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  const context = await getAuthContext()
  return session && context ? { session, context } : null
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), c = config()
    const authorization = validateAuthorization(Object.fromEntries(url.searchParams))
    const who = await approver()
    if (!who) {
      const login = new URL('/login', c.origin)
      login.searchParams.set('returnTo', `/oauth/authorize${url.search}`)
      return Response.redirect(login, 303)
    }
    // The envelope pins the approval to this login session and, separately,
    // to this person in this organization. The session hash alone would be
    // enough today, but the identity is what the code will carry, and binding
    // it explicitly means the page can never approve on behalf of anyone other
    // than the name printed on it — even if a session later learns to act in
    // more than one workspace.
    const approval = signEnvelope({ purpose: 'oauth-consent', authorization, sessionHash: hashToken(who.session),
      userId: who.context.userId, organizationId: who.context.organizationId, expiresAt: Date.now() + 10 * 60_000 })
    const { html, headers } = renderConsentPage({ authorization, approval, clientId: c.clientId, redirects: c.redirects,
      viewer: { displayName: who.context.viewer.displayName, organizationName: who.context.organization.name } })
    return new Response(html, { headers })
  } catch (error) { return oauthError(error) }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request, true)
    const who = await approver()
    if (!who) throw new CrmError('unauthorized', 'Log in to the CRM again before connecting.')
    const form = new URLSearchParams(await readBody(request, 24000))
    const approval = readEnvelope(form.get('approval') ?? '')
    // Re-resolved rather than trusted from the envelope: the envelope proves
    // what was shown, the session proves who is submitting, and the two must
    // still agree — a membership revoked between render and click fails here.
    if (approval.purpose !== 'oauth-consent' || approval.sessionHash !== hashToken(who.session)
      || approval.userId !== who.context.userId || approval.organizationId !== who.context.organizationId) {
      throw new CrmError('invalid_request', 'The connection approval belongs to a different login session.')
    }
    const authorization = validateAuthorization(approval.authorization)
    if (form.get('decision') === 'deny') {
      const callback = new URL(authorization.redirect_uri)
      callback.searchParams.set('error', 'access_denied'); callback.searchParams.set('state', authorization.state); callback.searchParams.set('iss', config().origin)
      return Response.redirect(callback, 303)
    }
    if (form.get('decision') !== 'allow') throw new CrmError('invalid_request', 'Choose whether to connect.')
    return Response.redirect(await issueCode(crmDatabase(), authorization, { userId: who.context.userId, organizationId: who.context.organizationId }), 303)
  } catch (error) { return oauthError(error) }
}
