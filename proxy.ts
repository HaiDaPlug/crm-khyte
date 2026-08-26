import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'

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
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const authed = verifySession(request.cookies.get(SESSION_COOKIE)?.value)

  if (pathname === '/login') {
    // Someone with a live session has no business on the gate.
    if (authed) {
      return NextResponse.redirect(new URL('/', request.url))
    }
    return NextResponse.next()
  }

  if (!authed) {
    const url = new URL('/login', request.url)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
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
