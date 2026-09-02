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
    // Session pooler caps concurrent clients per PROJECT, not per process:
    // pool_size 15, shared by every process that opens this URL. That ceiling
    // is what `max` has to be sized against, and 5 divided into it three ways
    // — a dev server, a deployment and one more tab of either, and the next
    // read gets EMAXCONNSESSION and the app shows its error screen. Observed
    // exactly that on 2026-09-02. The slots were all held by this app itself
    // — see `idle_timeout` below, which is the setting that actually let it
    // happen. Sizing `max` alone does not prevent it.
    //
    // 2 fits roughly seven processes under the same ceiling. It costs latency
    // on `loadSnapshot()`, whose eight parallel reads now queue four deep
    // instead of two — a few hundred rows for one operator, so the wait is
    // small and a slower page beats an unreachable one.
    //
    // Do NOT reach for the transaction pooler (port 6543) to escape the cap.
    // Measured against postgres.js 3.4.9: a pooled connection serves about two
    // queries and then stalls on reuse, silently, forever — roughly 2×`max`
    // queries succeed and the rest never settle. Raising `max` only moves the
    // cliff. That turns a loud error screen into a hung tab no boundary can
    // catch. Transaction mode needs a different driver, not a different number.
    max: 2,
    // Hand a connection back once it has been unused this long.
    //
    // This is the setting whose absence caused the outage, not `max`.
    // postgres.js defaults `idle_timeout` to null — never close an idle
    // connection — so the only thing that ever reclaimed one was
    // `max_lifetime`, itself a randomised 30-60 minutes. One page load
    // therefore pinned up to `max` project-wide slots for up to an hour after
    // the read had finished. Caught in the act on 2026-09-02: twelve idle
    // Supavisor backends, two of them holding slots 26 minutes after their
    // last query, with the session pooler refusing every new client.
    //
    // 20s and not less, because SnapshotSync polls the change-stamp every 12s
    // (components/layout/SnapshotSync.tsx). One connection stays warm across
    // those polls — a slot genuinely in use — while the second, which only
    // exists to parallelise a snapshot read, is released between page loads.
    // Dropping below 12s would reconnect on every poll and pay a fresh
    // handshake for nothing.
    idle_timeout: 20,
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
