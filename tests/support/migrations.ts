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
 * so `db:push` cannot apply a follow-up ahead of the code it depends on; that
 * ordering is the one this arrangement exists to prevent. Once the build is
 * verified live the file is *moved* into supabase/migrations/ and pushed. Both
 * layouts are therefore real, and the suites have to pass in both without an
 * edit: each follow-up is found by its name ending rather than by its
 * directory, and is excluded from the ordinary migration list wherever it
 * sorts, then applied deliberately — so a promoted follow-up is never applied
 * as an ordinary migration, and a migration sorting after it still runs.
 *
 * TWO FOLLOW-UPS NOW, with different preconditions and a strict order between
 * them:
 *
 *   drop_organization_rollout.sql — Stage 1 step 5. Drops the organization_id
 *     defaults and the old week index; applied by finishRollout(), which first
 *     asserts the guard that stands until it runs.
 *   drop_notes.sql — Stage 2 step 4. Re-runs the notes backfill, refuses to
 *     drop while any notes row has no entry, then drops public.notes and the
 *     backfill function; applied by dropNotes(). It must come AFTER the
 *     cleanup, because the cleanup still names public.notes.
 *
 * No .env files, remote database, production credentials, or network access.
 */

const MIGRATIONS = 'supabase/migrations'
const FOLLOWUPS = 'supabase/followups'

/** The cleanup's filename ending. The timestamp in front of it may change
 *  when the file is promoted; this part is what identifies it. */
export const ROLLOUT_CLEANUP_SUFFIX = 'drop_organization_rollout.sql'

/** The notes-drop follow-up's filename ending, identified the same way and for
 *  the same reason. Distinct from the cleanup's ending, so neither suffix can
 *  match the other's file. */
export const NOTES_DROP_SUFFIX = 'drop_notes.sql'

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
 * Every migration to apply, in filename order, with BOTH follow-ups excluded
 * wherever they sort should either have been promoted into
 * supabase/migrations/ — they are applied deliberately by finishRollout() and
 * dropNotes() instead. A suite applies these, asserts the guard, finishes the
 * rollout, and drops notes only if it means to.
 *
 * Excluded rather than truncated at: a migration whose timestamp sorts *after*
 * a promoted follow-up is an ordinary migration and must still run —
 * 20261001120000_journal.sql is exactly that, and is required to sort after the
 * cleanup. Truncating would drop it silently, which is the one failure this
 * list cannot afford. scripts/pg-concurrency.mjs filters the same way.
 */
export async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS))
    .filter(f => f.endsWith('.sql') && !f.endsWith(ROLLOUT_CLEANUP_SUFFIX) && !f.endsWith(NOTES_DROP_SUFFIX))
    .sort()
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

/** Where the notes-drop follow-up is today: the follow-up directory, or the
 *  migrations directory once it has been promoted. Mirrors
 *  rolloutCleanupPath() exactly, because a promoted file must need no test
 *  edit. */
export async function notesDropPath(): Promise<string> {
  const path = (await findBySuffix(FOLLOWUPS, NOTES_DROP_SUFFIX)) ?? (await findBySuffix(MIGRATIONS, NOTES_DROP_SUFFIX))
  assert.ok(path, `a file ending in ${NOTES_DROP_SUFFIX} must exist in ${FOLLOWUPS} or ${MIGRATIONS}`)
  return path
}

/**
 * Applies the notes-drop follow-up: step 4 of the Stage 2 deploy order.
 *
 * ONLY AFTER finishRollout(). The rollout cleanup still names `public.notes`
 * in its list of defaults to drop, so dropping the table first would make the
 * cleanup fail on a missing relation — the same ordering the file's own header
 * states. Only a suite that is deliberately rehearsing the drop calls this;
 * every other suite leaves `notes` standing, which is what the deployed Stage 2
 * build does too.
 *
 * The file re-runs public.journal_migrate_notes() before it drops anything, so
 * rows the old build wrote after the journal migration landed arrive as entries
 * here rather than being lost, and it raises rather than drops if any notes row
 * still has no matching entry.
 */
export async function dropNotes(pg: Execer): Promise<void> {
  await pg.exec(await readSql(await notesDropPath()))
}
