import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SESSION_COOKIE, verifySession } from './session'

/**
 * The authorization check, kept close to the data rather than only in Proxy.
 *
 * Proxy runs first and redirects unauthenticated page requests, but the Next
 * docs are explicit that it should not be the only defense — it is an
 * optimistic check on a cookie, and Server Actions are reachable by direct
 * POST without ever passing through a page render. Anything that reads or
 * writes real data calls one of these instead of trusting that Proxy ran.
 *
 * `cache` memoizes per render pass, so a layout and a page asking the same
 * question in one request verify the signature once.
 */
export const isAuthenticated = cache(async (): Promise<boolean> => {
  const cookieStore = await cookies()
  return verifySession(cookieStore.get(SESSION_COOKIE)?.value)
})

/**
 * Guard for pages and layouts: bounces to the gate instead of rendering.
 *
 * Note this cannot be used inside a Server Action to protect a write —
 * redirect() there would send the client to the login page but the caller has
 * already committed to running the action. Use requireAuth() below for those.
 */
export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) {
    redirect('/login')
  }
}

/**
 * Guard for Server Actions: throws rather than redirects.
 *
 * A write that reaches this without a session is either a stale tab or a
 * direct POST, and both should fail loudly rather than quietly returning as
 * though the write happened.
 */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) {
    throw new Error('Unauthorized')
  }
}
