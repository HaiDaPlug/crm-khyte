import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase access.
 *
 * The `server-only` import above is the guard: if this module is ever pulled
 * into a Client Component the build fails rather than shipping the secret key
 * to the browser.
 *
 * A secret key (`sb_secret_…`), which like the legacy service_role key it
 * replaces holds Postgres BYPASSRLS. That is deliberate even now that people
 * have accounts: the app scopes every write to the caller's organization
 * itself (app/actions/*.ts, from the AuthContext in lib/auth/context.ts) and
 * the membership policies in 20260920120000_organizations.sql are a dormant
 * second line, not the enforcement. Individual identity lives in Supabase
 * Auth (lib/auth/identity.ts), which is the one place the publishable key is
 * used. A request-scoped client under the user's own JWT would let RLS do the
 * work — a later change, once a publishable-key path (Realtime, a browser
 * client) is actually wanted.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY

/**
 * Whether the app has database credentials. When false the data layer falls
 * back to the in-memory demo data so the UI still runs — see lib/db/queries.
 */
export const isSupabaseConfigured = Boolean(url && secretKey)

let cached: SupabaseClient | null = null
let warnedAboutLegacyKey = false
let announcedProject = false

/**
 * The project ref — the subdomain of the project URL — is the only thing that
 * identifies which database this app is talking to. Log it once at startup:
 * when you have more than one Supabase account, "which project am I actually
 * connected to" is the question worth answering out loud, and the ref answers
 * it without depending on which account a browser happens to be logged into.
 */
function announceProject(projectUrl: string): void {
  if (announcedProject) return
  announcedProject = true
  const ref = new URL(projectUrl).hostname.split('.')[0]
  console.log(`[khyte] Supabase project: ${ref}`)
}

/**
 * Legacy service_role keys are JWTs, so they start with `eyJ`. They still work
 * — Supabase keeps them alive until the end of 2026 — but this project has
 * moved to the new key format, and pasting the wrong row from the dashboard is
 * an easy mistake to make. Warn rather than throw: a working app that tells you
 * to swap a key beats a dead one.
 */
function warnIfLegacyKey(key: string): void {
  if (warnedAboutLegacyKey || !key.startsWith('eyJ')) return
  warnedAboutLegacyKey = true
  console.warn(
    '[khyte] SUPABASE_SECRET_KEY looks like a legacy JWT service_role key. ' +
      'It works for now, but legacy keys are deprecated — replace it with a ' +
      'secret key (sb_secret_…) from Settings → API Keys.'
  )
}

export function getSupabase(): SupabaseClient {
  if (!url || !secretKey) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and set ' +
        'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.'
    )
  }

  warnIfLegacyKey(secretKey)
  announceProject(url)

  cached ??= createClient(url, secretKey, {
    auth: {
      // No user sessions to keep — this client is stateless and server-side.
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return cached
}
