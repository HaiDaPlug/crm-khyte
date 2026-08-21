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
 * Measured 2026-08-21 by polling a trivial REST read every 300ms and recording
 * only the transitions. What the numbers say:
 *
 * - The rejection is `PGRST303 / JWT issued at future`, HTTP 401, and it lasted
 *   **617ms** before the same request succeeded untouched.
 * - The API's `Date` header ran ~2s *ahead* of this machine. Every part of the
 *   exchange is validated server-side, so the local clock is not involved —
 *   don't go resyncing w32tm over this.
 * - Four of the five incidents in the dev log burnt all three of the old
 *   attempts inside 600ms and still failed; one recovered. The classification
 *   was already right. The budget was 17ms too small.
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

/** Faults worth retrying on a read. Reads are pure, so all of these are safe. */
const TRANSIENT_READ =
  /issued at future|not yet valid|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|\b(?:502|503|504)\b/i

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
 * Backoff schedule, in milliseconds of waiting: 250, 500, 1000, 2000.
 *
 * Sized to the measurement rather than to a habit. The previous schedule
 * (three attempts, 200 + 400) made its last attempt at 600ms and gave up 17ms
 * short of a 617ms window. This one retries at 250ms, 750ms, 1.75s and 3.75s,
 * so the measured fault clears on the third attempt with ~3s still in hand.
 *
 * Doubling rather than adding matters: most of the budget sits in the last
 * wait, so a blip that clears immediately still costs ~250ms while a longer
 * one gets seconds of cover.
 */
const ATTEMPTS = 5
const BASE_DELAY_MS = 250
const delayFor = (attempt: number) => BASE_DELAY_MS * 2 ** (attempt - 1)

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
 * Anything else — a wrong key, a missing table, a constraint violation — throws
 * on the first attempt, so genuine misconfiguration still fails fast and loud
 * rather than taking five times as long to say the same thing.
 */
export async function withRetry<T>(
  label: string,
  operation: () => Promise<T>,
  shouldRetry: (message: string) => boolean
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (attempt >= ATTEMPTS || !shouldRetry(message)) throw cause

      const delay = delayFor(attempt)
      console.warn(
        `[khyte] ${label}: transient failure (attempt ${attempt}/${ATTEMPTS}), ` +
          `retrying in ${delay}ms — ${message}`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}
