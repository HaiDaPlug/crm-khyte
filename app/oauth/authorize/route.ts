import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import { crmDatabase } from '@/lib/crm/database'
import { CrmError } from '@/lib/crm/errors'
import { issueCode, validateAuthorization } from '@/lib/mcp/oauth'
import { config, hashToken, readEnvelope, signEnvelope } from '@/lib/mcp/security'
import { checkOrigin, noStore, oauthError, readBody } from '@/lib/mcp/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const labels: Record<string, string> = {
  'crm:read': 'Läsa företag, kontakter, prospekt, leads och uppgifter',
  'crm:outreach:write': 'Logga genomförd kontakt och uppdatera prospekt',
  'crm:leads:write': 'Lägga till leads',
  'crm:tasks:write': 'Skapa och tilldela uppgifter',
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), c = config()
    const authorization = validateAuthorization(Object.fromEntries(url.searchParams))
    const session = (await cookies()).get(SESSION_COOKIE)?.value
    if (!verifySession(session)) {
      const login = new URL('/login', c.origin)
      login.searchParams.set('returnTo', `/oauth/authorize${url.search}`)
      return Response.redirect(login, 303)
    }
    const approval = signEnvelope({ purpose: 'oauth-consent', authorization, sessionHash: hashToken(session!), expiresAt: Date.now() + 10 * 60_000 })
    return new Response(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anslut ChatGPT — Khyte CRM</title>
      <style>body{margin:0;background:#120f0c;color:#eee6dc;font:16px/1.6 system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(480px,calc(100% - 48px));padding:32px 0}h1{font-size:28px;line-height:1.2}p{color:#bcb1a5}ul{padding-left:22px}button{font:inherit;border-radius:8px;padding:10px 16px;border:1px solid #625242;background:#d4943c;color:#120f0c;cursor:pointer}button[value=deny]{background:transparent;color:#eee6dc}form{display:flex;gap:12px;margin-top:28px}</style></head>
      <body><main><p>Khyte CRM</p><h1>Anslut ChatGPT</h1><p>Ge den här anslutningen tillgång till teamets gemensamma CRM:</p>
      <ul>${authorization.scope.split(' ').map(scope => `<li>${escape(labels[scope])}</li>`).join('')}</ul>
      <p>Ni kan fortfarande logga för varandra. Vem som följde upp och vem som tilldelas en uppgift väljs separat.</p>
      <p>Anslutning: ${escape(c.clientId)}<br>Återgår till: ${escape(new URL(authorization.redirect_uri).origin)}</p>
      <form method="post" action="/oauth/authorize"><input type="hidden" name="approval" value="${escape(approval)}"><button name="decision" value="allow">Anslut</button><button name="decision" value="deny">Avbryt</button></form>
      </main></body></html>`, { headers: { ...noStore, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Frame-Options': 'DENY' } })
  } catch (error) { return oauthError(error) }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request, true)
    const session = (await cookies()).get(SESSION_COOKIE)?.value
    if (!session || !verifySession(session)) throw new CrmError('unauthorized', 'Log in to the CRM again before connecting.')
    const form = new URLSearchParams(await readBody(request, 24000))
    const approval = readEnvelope(form.get('approval') ?? '')
    if (approval.purpose !== 'oauth-consent' || approval.sessionHash !== hashToken(session)) throw new CrmError('invalid_request', 'The connection approval belongs to a different login session.')
    const authorization = validateAuthorization(approval.authorization)
    if (form.get('decision') === 'deny') {
      const callback = new URL(authorization.redirect_uri)
      callback.searchParams.set('error', 'access_denied'); callback.searchParams.set('state', authorization.state); callback.searchParams.set('iss', config().origin)
      return Response.redirect(callback, 303)
    }
    if (form.get('decision') !== 'allow') throw new CrmError('invalid_request', 'Choose whether to connect.')
    return Response.redirect(await issueCode(crmDatabase(), authorization), 303)
  } catch (error) { return oauthError(error) }
}
