/**
 * Runs `supabase db push` against the project in .env.local.
 *
 * Two ways to reach the database, picked automatically:
 *
 *   1. If the project is LINKED (supabase/.temp/project-ref exists, written by
 *      `npm run supabase -- link --project-ref <ref>`), push to the linked
 *      project. This is the normal Supabase workflow.
 *
 *   2. Otherwise fall back to SUPABASE_DB_URL, a plain Postgres connection
 *      string. This needs no account at all — useful before linking, or if you
 *      would rather never store an access token.
 *
 * Either way the account comes from .env.local rather than ~/.supabase, so the
 * CLI can never drift to a different Supabase account. See scripts/supabase.mjs.
 *
 * Usage:
 *   npm run db:push                    apply pending migrations
 *   npm run db:push -- --dry-run       show what would be applied
 *   npm run db:push -- --include-seed  also run supabase/seed.sql
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readEnvLocal, runSupabase } from './supabase.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`\n[khyte] ${message}\n`)
  process.exit(1)
}

const env = readEnvLocal()
const passthrough = process.argv.slice(2)

// `supabase link` records the ref here. Its presence is what makes --linked work.
const linkedRefPath = join(root, 'supabase', '.temp', 'project-ref')
const linkedRef = existsSync(linkedRefPath)
  ? readFileSync(linkedRefPath, 'utf8').trim()
  : null

if (linkedRef) {
  console.log(`[khyte] Target: linked project ${linkedRef}`)
  process.exit(runSupabase(['db', 'push', '--linked', ...passthrough]))
}

// --- not linked: fall back to the connection string ---

const dbUrl = env.SUPABASE_DB_URL
if (!dbUrl) {
  fail(
    'Not linked, and SUPABASE_DB_URL is not set in .env.local.\n' +
      '  Either link the project:\n' +
      '    npm run supabase -- link --project-ref <your-project-ref>\n' +
      '  or set SUPABASE_DB_URL (dashboard → Connect → Session pooler).'
  )
}

// The CLI requires a percent-encoded connection string. A password containing
// @ : / ? # or & will otherwise silently produce a wrong host or a parse error,
// which is a miserable thing to debug — catch it here instead.
let parsed
try {
  parsed = new URL(dbUrl)
} catch {
  fail(
    'SUPABASE_DB_URL is not a valid URL. If your database password contains\n' +
      '  special characters (@ : / ? # &), percent-encode them — @ becomes %40.'
  )
}

if (/YOUR-PASSWORD|\[|\]/.test(decodeURIComponent(parsed.password))) {
  fail(
    'SUPABASE_DB_URL still contains the [YOUR-PASSWORD] placeholder.\n' +
      '  Replace it with your database password (Settings → Database).'
  )
}

// Echo the target so it is never ambiguous which project is about to change.
// Host only: the password lives in this string.
console.log(`[khyte] Target: ${parsed.hostname}`)

process.exit(runSupabase(['db', 'push', '--db-url', dbUrl, ...passthrough]))
