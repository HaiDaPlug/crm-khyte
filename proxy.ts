import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import {
  DISPLAY_TOKEN_PARAM,
  colleagueFromDisplayPath,
  verifyDisplayToken,
} from '@/lib/auth/display-token'

/**
 * The gate's first pass.
 *
 * This is Next 16's `proxy.ts` — the `middleware.ts` convention was renamed
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * It also runs on the Node.js runtime now, which is why the session module's
 * node:crypto works here.
 *
 * Deliberately an optimistic check: it reads and verifies the cookie's
 * signature and nothing else — no database, no I/O — because Proxy runs on
 * every request including prefetches. The real enforcement for data access is
 * lib/auth/guard.ts.
 */

/** Lets the root layout see which route it is rendering. Layouts get no
 *  pathname on the server, and app/layout.tsx needs one to keep the CRM
 *  chrome and snapshot off the wallpaper. */
const PATHNAME_HEADER = 'x-pathname'

/**
 * Passes the request through, stamping the real pathname on it.
 *
 * The header is always overwritten, never merged: a client is free to send its
 * own `x-pathname`, and forwarding that would let anyone claim to be on a
 * display route and suppress the layout. Setting it here from `nextUrl` means
 * whatever arrived is discarded.
 */
function forward(request: NextRequest, pathname: string) {
  const headers = new Headers(request.headers)
  headers.set(PATHNAME_HEADER, pathname)
  return NextResponse.next({ request: { headers } })
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const authed = verifySession(request.cookies.get(SESSION_COOKIE)?.value)

  if (pathname === '/login') {
    // Someone with a live session has no business on the gate.
    if (authed) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return forward(request, pathname)
  }

  if (!authed) {
    // The wallpaper's exception. Lively renders in a bare Chromium embed with
    // no session and no way to obtain one, so a signed token in the URL stands
    // in for the cookie — but only here, and only for the colleague the token
    // was issued for. See lib/auth/display-token.ts for why this is weaker
    // than a session and why that is acceptable on a read-only board.
    //
    // Scoped to the pathname rather than a flag on the request: a Server
    // Action POSTs to the page URL it was called from, so an action fired from
    // a display route would arrive with this same path. It is still only ever
    // a read — the display page renders no forms and calls no actions — and
    // requireAuth() in app/actions/crm.ts rejects a tokened request anyway,
    // because a token is not a session.
    const colleague = colleagueFromDisplayPath(pathname)
    if (colleague) {
      const token = request.nextUrl.searchParams.get(DISPLAY_TOKEN_PARAM)
      if (verifyDisplayToken(colleague, token ?? undefined)) {
        return forward(request, pathname)
      }
    }

    const url = new URL('/login', request.url)
    return NextResponse.redirect(url)
  }

  return forward(request, pathname)
}

export const config = {
  /**
   * Everything except Next's own assets and the favicon.
   *
   * The Server Actions endpoint is intentionally NOT excluded — actions POST
   * to the page URL they were called from, so they pass through here and a
   * request without a session is turned away before it reaches the action.
   * The login action is the exception that makes /login public above.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
