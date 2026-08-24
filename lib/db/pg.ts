import 'server-only'

import postgres from 'postgres'

/**
 * Direct Postgres access for reads, bypassing PostgREST entirely.
 *
 * PostgREST exchanges the secret key for a short-lived JWT on every request,
 * and that exchange is what produces the `JWT issued at future` fault
 * documented in ./retry — a brief clock disagreement between the minting and
 * validating services. SUPABASE_DB_URL mints no token, so a query over this
 * connection cannot hit that fault at all. See ./retry for the history of why
 * retrying the PostgREST path stopped being enough.
 */

const dbUrl = process.env.SUPABASE_DB_URL

export const isDirectDbConfigured = Boolean(dbUrl)

/**
 * Cached on `globalThis`, not a module-level `let`.
 *
 * Every other client in this codebase (Supabase, PostgREST) is stateless
 * HTTP, so a plain module-level singleton was fine. This one holds real
 * Postgres session slots, and Next's dev server re-evaluates route modules
 * on every hot reload — a module-level cache would open a fresh pool each
 * time while the previous one's connections stayed open server-side, and the
 * Session pooler's `pool_size: 15` is exhausted within a handful of edits.
 * `globalThis` survives the module re-evaluation, so the pool is opened once
 * per server process regardless of how many times this file reloads.
 */
const globalForDb = globalThis as unknown as { khyteDb?: ReturnType<typeof postgres> }

export function getDb() {
  if (!dbUrl) {
    throw new Error(
      'SUPABASE_DB_URL is not configured. Copy .env.example to .env.local and set it — ' +
        'dashboard → Connect → Session pooler.'
    )
  }

  globalForDb.khyteDb ??= postgres(dbUrl, {
    // Session pooler caps concurrent clients per project (pool_size: 15) —
    // stay well under it so this app never starves other connections to the
    // same project, dev-reload churn included.
    max: 5,
    // Server-side reads only; no interactive transactions or prepared
    // statement churn across serverless invocations.
    prepare: false,
    types: {
      // ./mappers expects `date`/`timestamptz` as the same strings PostgREST
      // sent — e.g. dateOrEmpty() assigns the value straight through with no
      // conversion. postgres.js otherwise parses these into `Date` objects,
      // which would silently corrupt every date field. Keep them as text.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      timestamptz: {
        to: 1184,
        from: [1184],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
  })

  return globalForDb.khyteDb
}
