import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'

import { getAuthContext, type AuthContext } from './context'

/**
 * The authorization checks, kept close to the data rather than only in Proxy.
 *
 * Proxy runs first and redirects unauthenticated page requests, but the Next
 * docs are explicit that it should not be the only defense — it is an
 * optimistic check on a cookie, and Server Actions are reachable by direct
 * POST without ever passing through a page render. Anything that reads or
 * writes real data calls one of these instead of trusting that Proxy ran, and
 * gets back the context it must scope every query by.
 */

export const isAuthenticated = cache(async (): Promise<boolean> => {
  return (await getAuthContext()) !== null
})

/**
 * Guard for pages and layouts: bounces to the gate instead of rendering.
 *
 * Note this cannot be used inside a Server Action to protect a write —
 * redirect() there would send the client to the login page but the caller has
 * already committed to running the action. Use requireAuth() below for those.
 */
export async function requireSession(): Promise<AuthContext> {
  const context = await getAuthContext()
  if (!context) redirect('/login')
  return context
}

/**
 * Guard for Server Actions and Route Handlers: throws rather than redirects.
 *
 * A write that reaches this without a session is either a stale tab or a
 * direct POST, and both should fail loudly rather than quietly returning as
 * though the write happened.
 */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext()
  if (!context) throw new Error('Unauthorized')
  return context
}

/** Owner-only operations: managing who belongs to the organization. */
export async function requireOwner(): Promise<AuthContext> {
  const context = await requireAuth()
  if (context.viewer.role !== 'owner') throw new Error('Forbidden')
  return context
}

export type { AuthContext }
