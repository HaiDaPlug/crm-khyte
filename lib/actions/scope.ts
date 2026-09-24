import type { ActionScope } from '@/lib/types'

/**
 * The scope check every Server Action starts with, in one place.
 *
 * It lived in app/actions/crm.ts and was copied into app/actions/goals.ts,
 * which was tolerable while there were two of them. A `'use server'` module
 * cannot export a synchronous helper — every export of one is compiled into a
 * POST endpoint returning a promise — so the copy could not simply be exported
 * from crm.ts and imported by the others. Here, in an ordinary module, it can
 * be: crm.ts, goals.ts and journal.ts import the same function, and a unit
 * test can call it directly rather than only through an action that first
 * needs a session.
 *
 * No `server-only`. Nothing here reads a cookie, a connection or an
 * environment variable — it compares two pairs of strings — and the suites
 * that exercise it run without `--conditions=react-server`.
 *
 * WHAT IT IS FOR. A session belongs to one person in one organization, and a
 * tab that has been open a while may believe it is acting as somebody else:
 * the second tab signed in as a different person, and the cookie both tabs
 * share now names that person. The first tab's next save would commit as them,
 * into whatever organization they belong to, carrying a row id minted in the
 * old one — a perfectly authenticated write to the wrong place. The scope the
 * browser sends is its own statement of what it thought it was, and this is
 * where that statement meets the session that actually arrived.
 *
 * COMPARISON ONLY, NEVER AN AUTHORITY. No caller reads an organization or a
 * user id out of the scope; those come from the AuthContext alone. So the
 * worst a forged scope can do is refuse a write its sender was entitled to
 * make.
 */

/**
 * What a scope disagreement is reported as. Part of the contract with the
 * client store (lib/store/store.ts), which reads it as "this tab is finished"
 * and reloads the page rather than showing a toast and leaving the draft up.
 */
export const CONTEXT_MISMATCH = 'context_mismatch'

/**
 * No session behind the request: it expired, or the membership was revoked.
 * The Journal actions REPORT this, never throw it — a thrown Server Action
 * reaches the browser as a message (in production an opaque digest) that the
 * store cannot read as "this tab is finished", so the composer would offer a
 * retry that can never succeed instead of the page reloading to sign in with
 * the drafts kept. The store's `finishIdentity` keeps drafts for this code and
 * clears them for `context_mismatch`.
 */
export const UNAUTHORIZED = 'unauthorized'

/** The refusal shape, assignable to every action's own result type. */
export type ScopeRefusal = { ok: false; error: string }

/**
 * Compares what the caller thought it was with what the session says it is.
 *
 * Returns the refusal to hand straight back, or null when the two agree.
 * Called immediately after requireAuth() and before anything touches the
 * database, so a write submitted under a stale identity is not partly applied,
 * not merely mis-scoped, but never started.
 *
 * `context` is taken structurally rather than as an AuthContext so this module
 * imports nothing from the auth layer: the two fields it compares are the two
 * fields it needs.
 */
export function scopeMismatch(
  context: { organizationId: string; userId: string },
  scope: ActionScope
): ScopeRefusal | null {
  if (scope.organizationId === context.organizationId && scope.userId === context.userId) {
    return null
  }
  return { ok: false, error: CONTEXT_MISMATCH }
}
