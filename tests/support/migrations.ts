import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'

/**
 * How both PGlite suites get a migrated database.
 *
 * One helper rather than a copy in each suite, because the sequence is a rule
 * about the deploy and not a convenience: the migrations run in filename
 * order, the rollout guard is asserted while it still stands, and only then
 * is the cleanup applied — from wherever it lives.
 *
 * WHY "WHEREVER IT LIVES". supabase/followups/ is outside supabase/migrations/
 * so `db:push` cannot apply the cleanup ahead of the code that writes
 * organization_id explicitly; that ordering is the one this arrangement
 * exists to prevent. Once the build is verified live the file is *moved* into
 * supabase/migrations/ and pushed. Both layouts are therefore real, and the
 * suites have to pass in both without an edit: the file is found by its name
 * ending rather than by its directory, and the migration list stops before it
 * so a promoted cleanup is never applied as an ordinary migration.
 *
 * No .env files, remote database, production credentials, or network access.
 */

const MIGRATIONS = 'supabase/migrations'
const FOLLOWUPS = 'supabase/followups'

/** The cleanup's filename ending. The timestamp in front of it may change
 *  when the file is promoted; this part is what identifies it. */
export const ROLLOUT_CLEANUP_SUFFIX = 'drop_organization_rollout.sql'

/** Anything that can run SQL — PGlite itself, or a transaction of it. */
export interface Execer {
  exec(sql: string): Promise<unknown>
  query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>
}

/** A migration's text, ready for PGlite. gen_random_uuid is built into modern
 *  Postgres; PGlite does not bundle pgcrypto. */
export async function readSql(path: string): Promise<string> {
  return (await readFile(path, 'utf8')).replace('create extension if not exists pgcrypto;', '')
}

async function findBySuffix(directory: string, suffix: string): Promise<string | null> {
  try {
    const found = (await readdir(directory)).filter(f => f.endsWith(suffix)).sort()
    return found.length ? `${directory}/${found[found.length - 1]}` : null
  } catch {
    // The directory may not exist at all once the follow-up has been promoted.
    return null
  }
}

/**
 * Every migration to apply, in filename order, stopping before the rollout
 * cleanup should it have been promoted into supabase/migrations/. A suite
 * applies these, asserts the guard, and then finishes the rollout deliberately.
 */
export async function migrationFiles(): Promise<string[]> {
  const files = (await readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort()
  const promoted = files.findIndex(f => f.endsWith(ROLLOUT_CLEANUP_SUFFIX))
  return promoted === -1 ? files : files.slice(0, promoted)
}

/**
 * Applies the migrations in order, optionally stopping before one of them —
 * which is how the migration suite reaches the schema as it stood the moment
 * before the organizations migration. Returns the files it applied.
 */
export async function applyMigrations(pg: Execer, options: { stopBefore?: string } = {}): Promise<string[]> {
  const files = await migrationFiles()
  const stop = options.stopBefore ? files.indexOf(options.stopBefore) : files.length
  assert.ok(stop > 0, `${options.stopBefore} must exist in ${MIGRATIONS} and cannot be the first migration`)
  const applied = files.slice(0, stop)
  for (const file of applied) await pg.exec(await readSql(`${MIGRATIONS}/${file}`))
  return applied
}

/** Where the rollout cleanup is today: the follow-up directory, or the
 *  migrations directory once it has been promoted. */
export async function rolloutCleanupPath(): Promise<string> {
  const path = (await findBySuffix(FOLLOWUPS, ROLLOUT_CLEANUP_SUFFIX)) ?? (await findBySuffix(MIGRATIONS, ROLLOUT_CLEANUP_SUFFIX))
  assert.ok(path, `a file ending in ${ROLLOUT_CLEANUP_SUFFIX} must exist in ${FOLLOWUPS} or ${MIGRATIONS}`)
  return path
}

/**
 * Asserts the rollout guard refuses a second organization, then applies the
 * cleanup that retires it.
 *
 * The guard is the database keeping a rule a document could only state: while
 * the organization_id defaults and the old single-column week index stand, a
 * forgotten insert would land silently in Khyte and two organizations could
 * not archive the same week at all. Asserting it here means every suite that
 * goes on to create a second organization has proved it could not have done so
 * a moment earlier.
 */
export async function finishRollout(pg: Execer, probeOrganizationId: string): Promise<void> {
  await assert.rejects(
    pg.query(`insert into organizations (id, name, slug) values ($1, 'Refused AB', 'refused')`, [probeOrganizationId]),
    /rollout finished/
  )
  await pg.exec(await readSql(await rolloutCleanupPath()))
}
