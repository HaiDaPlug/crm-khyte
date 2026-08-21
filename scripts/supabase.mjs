/**
 * Runs the Supabase CLI scoped to THIS project's account.
 *
 * The problem it solves: `supabase link`, and every command that talks to the
 * Management API, authenticates with the token in ~/.supabase/access-token.
 * That file is global to the machine and account-wide, so with two Supabase
 * accounts the CLI keeps resolving to whichever one you logged into last —
 * there is no per-directory setting that overrides it.
 *
 * `SUPABASE_ACCESS_TOKEN` does override it. So this wrapper reads the token
 * from .env.local (per-project, gitignored) and injects it for the duration of
 * one command. Nothing is written to ~/.supabase, and your other account is
 * never consulted.
 *
 * Usage — anything the CLI accepts:
 *   npm run supabase -- link --project-ref <ref>
 *   npm run supabase -- db push
 *   npm run supabase -- projects list
 *   npm run supabase -- migration list
 *
 * Falls back gracefully: if SUPABASE_ACCESS_TOKEN is absent it still runs, and
 * commands that only need a database connection (like `db push --db-url`) work
 * without any token at all.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function readEnvLocal() {
  const envPath = join(root, '.env.local')
  const env = {}
  if (!existsSync(envPath)) return env
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return env
}

/** Spawn the CLI with the project-scoped token injected. Returns the exit code. */
export function runSupabase(args, extraEnv = {}) {
  const local = readEnvLocal()
  const token = local.SUPABASE_ACCESS_TOKEN

  if (token && !/^sbp_/.test(token)) {
    console.error(
      '\n[khyte] SUPABASE_ACCESS_TOKEN in .env.local does not look like a\n' +
        '  personal access token. It should start with `sbp_`. Create one at\n' +
        '  https://supabase.com/dashboard/account/tokens while signed into the\n' +
        '  account that owns this project.\n'
    )
    return 1
  }

  const result = spawnSync('npx', ['supabase', ...args], {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      // Overrides ~/.supabase/access-token for this invocation only.
      ...(token ? { SUPABASE_ACCESS_TOKEN: token } : {}),
      // Lets `link` and `db push` find the database without prompting.
      ...(local.SUPABASE_DB_PASSWORD
        ? { SUPABASE_DB_PASSWORD: local.SUPABASE_DB_PASSWORD }
        : {}),
      ...extraEnv,
    },
  })

  return result.status ?? 1
}

// When invoked directly (rather than imported by db-push.mjs), forward every
// argument straight to the CLI.
const invokedDirectly = process.argv[1]
  ?.replace(/\\/g, '/')
  .endsWith('scripts/supabase.mjs')

if (invokedDirectly) {
  process.exit(runSupabase(process.argv.slice(2)))
}
