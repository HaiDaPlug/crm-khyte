/**
 * Measures the `PGRST303 / JWT issued at future` window against the live project.
 *
 * Supabase occasionally rejects a read with a token it considers not yet valid.
 * It is upstream, brief, and self-clearing — lib/db/retry.ts rides it out, and
 * the backoff schedule there is sized to what this script measured. Reach for
 * this when that assumption needs rechecking: a rejection that starts lasting
 * longer than the retry budget would show up as an error screen on a cold load,
 * and this is how you find out how long it actually lasts now.
 *
 * It polls a trivial read and reports only transitions — when rejections start,
 * when they stop, and how long the window was — so a clean run is quiet. The
 * fault needs an idle project to appear, so a run that catches nothing is not
 * evidence that it is gone; it usually means the project is warm.
 *
 * Credentials come from .env.local, like every other script here, and are never
 * printed.
 *
 * Usage:
 *   npm run db:skew              probe for 15 minutes
 *   npm run db:skew -- 60        probe for 60 seconds
 */
import { readEnvLocal } from './supabase.mjs'

const env = readEnvLocal()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SECRET_KEY

if (!url || !key) {
  console.error(
    '\n[khyte] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in\n' +
      '  .env.local before probing. See .env.example.\n'
  )
  process.exit(1)
}

/** Cheapest possible read: one id, no ordering, no joins. */
const endpoint = `${url}/rest/v1/companies?select=id&limit=1`
const INTERVAL_MS = 300
const HEARTBEAT_MS = 120_000
const runMs = Number(process.argv[2] ?? 900) * 1000

const stamp = () => new Date().toISOString().slice(11, 23)

let failingSince = null
let failedPolls = 0
let okPolls = 0
let lastHeartbeat = Date.now()
const started = Date.now()

async function probe() {
  const at = Date.now()
  try {
    const res = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })

    if (res.ok) {
      okPolls++
      if (failingSince) {
        console.log(
          `${stamp()}  RECOVERED after ${at - failingSince}ms (${failedPolls} failed polls)`
        )
        failingSince = null
        failedPolls = 0
      }
      return
    }

    failedPolls++
    if (failingSince) return

    failingSince = at
    const body = await res.text()
    console.log(`${stamp()}  FAIL START  status=${res.status}`)
    console.log(`            ${body.slice(0, 200)}`)
    // The two clocks, side by side: if these ever diverge by more than a couple
    // of seconds, the assumption that the local clock is uninvolved is worth
    // revisiting. As of 2026-08-21 the server ran ~2s ahead and it did not matter.
    console.log(`            local=${new Date().toUTCString()}`)
    console.log(`            server=${res.headers.get('date')}`)
  } catch (cause) {
    failedPolls++
    if (failingSince) return
    failingSince = at
    console.log(`${stamp()}  FAIL START (network) ${cause.message}`)
  }
}

console.log(
  `${stamp()}  probing ${new URL(url).hostname.split('.')[0]} every ${INTERVAL_MS}ms ` +
    `for ${Math.round(runMs / 1000)}s`
)

const timer = setInterval(async () => {
  if (Date.now() - started > runMs) {
    clearInterval(timer)
    console.log(`${stamp()}  done — ${okPolls} successful polls, ${failedPolls} failed`)
    return
  }

  await probe()

  if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = Date.now()
    console.log(`${stamp()}  ...alive, ${okPolls} ok polls so far`)
  }
}, INTERVAL_MS)
