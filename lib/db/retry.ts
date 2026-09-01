import 'server-only'

/**
 * Retry for transient Supabase faults.
 *
 * The fault this exists for is `JWT issued at future`. The app never mints a
 * token — `SUPABASE_SECRET_KEY` is an opaque `sb_secret_…`, and the API gateway
 * exchanges it for a short-lived JWT on every request. When the minting service's
 * clock runs a second or two ahead of the validating one, that token is briefly
 * not yet valid and the read is rejected. It clears on its own.
 *
 * Measured 2026-08-21, in two passes, because the first one got it wrong in a
 * way worth recording. What the numbers say:
 *
 * - The rejection is `PGRST303 / JWT issued at future`, HTTP 401.
 * - It runs for **at least 4 seconds**. Three incidents under this schedule
 *   failed continuously for 4.04s, 3.94s and 3.95s.
 * - An earlier probe reported a 617ms window and the budget was sized to it.
 *   That number was a *partial* observation: a continuous poller only sees a
 *   window from the moment it happens to hit one, so it measured the tail of
 *   an already-open window and called it the whole thing. Sizing to it left a
 *   budget that expired mid-fault, which looks exactly like the fix not
 *   working. Measure from the request that *triggers* the fault, not from
 *   whenever the poller arrived.
 * - The API's `Date` header ran ~2s *ahead* of this machine. Every part of the
 *   exchange is validated server-side, so the local clock is not involved —
 *   don't go resyncing w32tm over this.
 *
 * Two tempting explanations are ruled out, so nobody re-derives them:
 *
 * - *Not* periodic token rotation. The ~10-11 minute spacing in the dev log
 *   looked like a TTL, but 15 minutes of continuous polling — 2923 consecutive
 *   successful reads — never reproduced it. That spacing was how often someone
 *   happened to load the app, nothing more.
 * - *Not* a cold client or connection. Three fresh processes immediately after
 *   that run, 57 reads, zero failures.
 *
 * What is left is an upstream blip around an idle project, brief and
 * self-clearing, whose trigger isn't observable from this side. That is fine:
 * the response would be identical either way. A clock disagreement resolves by
 * elapsed time and nothing else, so the only correct client behaviour is to
 * wait it out with a budget that outlasts it — which matters because
 * `loadSnapshot()` deliberately fails loud, and a briefly not-yet-valid token
 * is otherwise a full error screen on someone's first page load.
 */

/**
 * Faults worth retrying on a read. Reads are pure, so all of these are safe.
 *
 * Two eras of shapes live here, and both are still reachable. The fetch/HTTP
 * strings came from the PostgREST read path; reads now go straight to Postgres
 * (see ./pg), where the driver reports its own faults.
 *
 * What a dropped pooler connection actually looks like, measured against a
 * proxy that kills the socket mid-query: a reset surfaces as `read ECONNRESET`
 * and lands on the existing pattern. A *graceful* close never reaches this
 * predicate at all — postgres.js re-queues the query on a fresh connection
 * itself, and the read succeeds without a retry from us.
 *
 * `CONNECTION_CLOSED` and `CONNECT_TIMEOUT` are here for the cases the driver
 * does surface — an exhausted `connect_timeout`, or a close it cannot re-queue
 * around. Both are `write <CODE> host:port` in its wording, matched by nothing
 * else in this set. Neither fired in the measurements above; they are the
 * belt to ECONNRESET's braces, not the fix on their own.
 *
 * Deliberately absent: `CONNECTION_ENDED` and `CONNECTION_DESTROYED`. Those
 * mean the pool object itself is gone rather than that a connection dropped,
 * so no amount of retrying against it will reconnect — they should fail at
 * once rather than spend the budget first.
 */
const TRANSIENT_READ =
  /issued at future|not yet valid|fetch failed|socket hang up|CONNECTION_CLOSED|CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|EAI_AGAIN|\b(?:502|503|504)\b/i

/**
 * Narrower set for writes.
 *
 * Auth-timing rejections happen *before* the statement runs, so nothing landed
 * and a retry is clean. Network faults are excluded on purpose: a dropped
 * connection can mean the write succeeded and only the response was lost, and
 * retrying that reports a primary-key violation for a row that is actually
 * fine. Ids are client-generated UUIDs, so the retry can't duplicate a row —
 * but it can turn a successful write into a reported failure, which is worse
 * than letting the caller see the original error.
 */
const RETRYABLE_WRITE = /issued at future|not yet valid/i

/**
 * Waiting strategy: back off briefly, then poll at a steady 750ms.
 *
 * Textbook exponential backoff is the wrong shape here, and trying it showed
 * why: doubling puts nothing between 3.75s and 7.75s, so a 4s window — the
 * length actually measured — was only noticed at 7.75s. The page sat blank for
 * twice as long as the fault lasted.
 *
 * Backoff exists to shed load off a dependency that is struggling. This
 * dependency is not struggling; it is holding a door shut until a clock
 * catches up. Our polling costs it nothing, and we want back in the moment it
 * opens. So: 250ms, 500ms, 1s to clear short blips cheaply, then a flat 750ms
 * so recovery is spotted within 750ms of it happening rather than at the next
 * power of two.
 */
const EARLY_DELAYS_MS = [250, 500, 1000]
const STEADY_DELAY_MS = 750
const delayFor = (attempt: number) => EARLY_DELAYS_MS[attempt - 1] ?? STEADY_DELAY_MS

/**
 * How long we are willing to wait, by what went wrong.
 *
 * A clock disagreement *will* resolve itself, so patience is warranted: 8s is
 * about as long as a page can sit before waiting is worse than failing, and it
 * covers the ~4s windows with room to spare.
 *
 * Everything else — a dead socket, a 503 — has no such promise, and eight
 * seconds of hope before an error screen is worse than a quick honest answer.
 * Those get 2.5s.
 *
 * If skew windows ever outgrow 8s, more waiting stops being the answer: take
 * PostgREST out of the read path instead. SUPABASE_DB_URL is already
 * configured for migrations, and a direct Postgres connection mints no token,
 * so it cannot have this fault at all.
 */
const SKEW_BUDGET_MS = 8_000
const OTHER_BUDGET_MS = 2_500

/**
 * The clock-skew rejection specifically (PostgREST answers `PGRST303`), as
 * opposed to a network blip. Worth telling apart at the point of failure: the
 * credentials are fine, so error text that sends the reader to check their key
 * is pointing at the wrong thing.
 */
const CLOCK_SKEW = /issued at future|not yet valid|PGRST303/i

export const isTransientRead = (message: string) => TRANSIENT_READ.test(message)
export const isRetryableWrite = (message: string) => RETRYABLE_WRITE.test(message)
export const isClockSkew = (message: string) => CLOCK_SKEW.test(message)

/**
 * Runs `operation`, retrying while `shouldRetry` matches the failure.
 *
 * Bounded by elapsed time rather than a number of attempts: the thing being
 * waited out is a duration, so the budget that matters is "how long will this
 * page sit here", not "how many requests did we send".
 *
 * Anything else — a wrong key, a missing table, a constraint violation — throws
 * on the first attempt, so genuine misconfiguration still fails fast and loud
 * rather than taking eight seconds to say the same thing.
 */
export async function withRetry<T>(
  label: string,
  operation: () => Promise<T>,
  shouldRetry: (message: string) => boolean
): Promise<T> {
  const startedAt = Date.now()

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!shouldRetry(message)) throw cause

      const budget = isClockSkew(message) ? SKEW_BUDGET_MS : OTHER_BUDGET_MS
      const elapsed = Date.now() - startedAt
      const delay = delayFor(attempt)
      // Stop when the next wait would run past the budget rather than after it
      // already has — the caller is waiting on this, so overshooting the number
      // in the log is not free.
      if (elapsed + delay > budget) throw cause

      console.warn(
        `[khyte] ${label}: transient failure (attempt ${attempt}, ${elapsed}ms of ` +
          `${budget}ms budget), retrying in ${delay}ms — ${message}`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}
