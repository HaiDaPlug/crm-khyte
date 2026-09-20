import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'

import type { Queryable } from '@/lib/crm/database'
import { crmDatabase } from '@/lib/crm/database'
import { isDirectDbConfigured } from '@/lib/db/pg'
import { isTransientRead, withRetry } from '@/lib/db/retry'
import type { ColleagueId, MemberRole, Organization, Viewer } from '@/lib/types'
import { SESSION_COOKIE, hashSessionToken, readSessionCookie } from './session'

/**
 * Who is asking, and on behalf of which organization.
 *
 * This is the one object every read, write, route and tool derives its scope
 * from. It comes from a verified session joined to an *active* membership —
 * never from a parameter the client or a model supplied. Revoking a membership
 * therefore cuts access on the next request, queued work included, without
 * anything having to be told.
 */
export interface AuthContext {
  sessionId: string
  userId: string
  organizationId: string
  organization: Organization
  viewer: Viewer
}

type ContextRow = {
  session_id: string
  user_id: string
  organization_id: string
  org_name: string
  org_slug: string
  org_timezone: string
  member_id: string
  role: MemberRole
  display_name: string
  email: string
  colleague: ColleagueId | null
}

/**
 * Resolves a cookie value to a context against the given database, or null.
 *
 * Pure of Next so it can be exercised in the PGlite suite. The cookie's
 * signature and expiry are checked first (no I/O); only a well-formed cookie
 * costs a query. The join is what enforces the rules in one place: the
 * session must exist, be unrevoked and unexpired; the membership must be
 * active; the organization must exist.
 */
export async function resolveAuthContext(
  db: Queryable,
  cookieValue: string | undefined
): Promise<AuthContext | null> {
  const session = readSessionCookie(cookieValue)
  if (!session) return null

  const [row] = await db.query<ContextRow>(
    `select s.id as session_id, s.user_id, o.id as organization_id,
            o.name as org_name, o.slug as org_slug, o.timezone as org_timezone,
            m.id as member_id, m.role, m.display_name, m.email, m.colleague
     from app_sessions s
     join organization_members m
       on m.organization_id = s.organization_id and m.user_id = s.user_id and m.status = 'active'
     join organizations o on o.id = s.organization_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
     limit 1`,
    [hashSessionToken(session.token)]
  )
  if (!row) return null

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    organization: {
      id: row.organization_id,
      name: row.org_name,
      slug: row.org_slug,
      timezone: row.org_timezone,
    },
    viewer: {
      userId: row.user_id,
      memberId: row.member_id,
      role: row.role,
      displayName: row.display_name,
      email: row.email,
      ...(row.colleague ? { colleague: row.colleague } : {}),
    },
  }
}

/**
 * The context for the current request, or null when nobody is logged in.
 *
 * `cache` memoizes per render pass, so a layout, a page and an action asking
 * the same question in one request cost one query. Without a database there
 * can be no sessions, so the answer is null rather than an error — the app
 * still boots, it simply cannot be entered.
 *
 * A broken database throws, on purpose: a configured but unreachable
 * database must be loud (see lib/db/queries), not look like a logout. Only
 * the transient faults ./retry knows about are waited out.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  if (!isDirectDbConfigured) return null

  const cookieStore = await cookies()
  const value = cookieStore.get(SESSION_COOKIE)?.value
  if (!readSessionCookie(value)) return null

  return withRetry('session read', () => resolveAuthContext(crmDatabase(), value), isTransientRead)
})
