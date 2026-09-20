import 'server-only'
import type { Authorization } from './oauth'
import { noStore } from './http'

/**
 * The consent page for connecting ChatGPT: the HTML and the headers it must be
 * served with.
 *
 * Kept apart from the route so the PGlite suite can render it and assert on
 * the headers without booting Next. The page names the person and the
 * organization because that is what approval now means — not "let ChatGPT
 * into the CRM" but "let ChatGPT act as me, in this workspace": every record
 * the connection saves is recorded against that account and scoped to that
 * organization. Who is credited with the work (followedUpBy, assignee) is
 * still chosen per action, which is why the page also says colleagues can
 * keep logging for each other.
 */

// Chrome applies form-action to the redirect that follows the submission, so
// the callback origin must be listed or approval navigates nowhere at all.
const formAction = (redirects: string[]) =>
  ["'self'", ...new Set(redirects.map(uri => new URL(uri).origin))].join(' ')
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const labels: Record<string, string> = {
  'crm:read': 'Läsa företag, kontakter, prospekt, leads och uppgifter',
  'crm:outreach:write': 'Logga genomförd kontakt och uppdatera prospekt',
  'crm:leads:write': 'Lägga till leads',
  'crm:tasks:write': 'Skapa och tilldela uppgifter',
}

export function renderConsentPage(input: {
  authorization: Authorization
  /** The signed consent envelope the form hands back on POST. */
  approval: string
  clientId: string
  /** The configured callback URIs; their origins are allowed as form targets. */
  redirects: string[]
  viewer: { displayName: string; organizationName: string }
}): { html: string; headers: Record<string, string> } {
  const { authorization, approval, clientId, redirects, viewer } = input
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anslut ChatGPT — Khyte CRM</title>
      <style>body{margin:0;background:#120f0c;color:#eee6dc;font:16px/1.6 system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(480px,calc(100% - 48px));padding:32px 0}h1{font-size:28px;line-height:1.2}p{color:#bcb1a5}ul{padding-left:22px}button{font:inherit;border-radius:8px;padding:10px 16px;border:1px solid #625242;background:#d4943c;color:#120f0c;cursor:pointer}button[value=deny]{background:transparent;color:#eee6dc}form{display:flex;gap:12px;margin-top:28px}</style></head>
      <body><main><p>Khyte CRM</p><h1>Anslut ChatGPT</h1>
      <p>Ansluter som ${escape(viewer.displayName)} · ${escape(viewer.organizationName)}</p>
      <p>Ge den här anslutningen tillgång till teamets gemensamma CRM:</p>
      <ul>${authorization.scope.split(' ').map(scope => `<li>${escape(labels[scope])}</li>`).join('')}</ul>
      <p>Ni kan fortfarande logga för varandra. Vem som följde upp och vem som tilldelas en uppgift väljs separat.</p>
      <p>Anslutning: ${escape(clientId)}<br>Återgår till: ${escape(new URL(authorization.redirect_uri).origin)}</p>
      <form method="post" action="/oauth/authorize"><input type="hidden" name="approval" value="${escape(approval)}"><button name="decision" value="allow">Anslut</button><button name="decision" value="deny">Avbryt</button></form>
      </main></body></html>`
  // Lowercase names, as the wire and the Fetch API treat them, so a test can
  // read the record directly or through `new Headers(...)` and see the same thing.
  const headers: Record<string, string> = {
    ...noStore,
    'content-type': 'text/html; charset=utf-8',
    // Under 'no-referrer' the browser serializes this page's own same-origin
    // form POST as 'Origin: null' (Fetch, "append a request Origin header"),
    // which the consent handler then refuses as invalid_origin. 'same-origin'
    // still withholds the referrer from the cross-origin callback, but keeps a
    // real Origin here.
    'referrer-policy': 'same-origin',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction(redirects)}; frame-ancestors 'none'; base-uri 'none'`,
    'x-frame-options': 'DENY',
  }
  return { html, headers }
}
