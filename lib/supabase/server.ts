import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side Supabase access.
 *
 * The `server-only` import above is the guard: if this module is ever pulled
 * into a Client Component the build fails rather than shipping the secret key
 * to the browser.
 *
 * We use a secret key (`sb_secret_…`) because there is no auth yet. Like the
 * legacy service_role key it replaces, it holds Postgres BYPASSRLS — which is
 * what lets the single-user app read and write rows whose `owner_id` is still
 * null. When auth lands, swap this for a request-scoped client built from the
 * user's session and the publishable key, and the RLS policies in
 * 20260819120000_init.sql start doing the work they were written for.
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
