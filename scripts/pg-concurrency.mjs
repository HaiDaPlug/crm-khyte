/**
 * Runs the real-PostgreSQL suite (tests/mcp-postgres.test.ts) against a
 * disposable server, so the lock protocol is exercised by two genuinely
 * concurrent connections rather than reasoned about.
 *
 * WHY A SEPARATE SERVER. The PGlite suites are a single connection: two
 * "simultaneous" callers there are two sequential ones, and an advisory lock
 * nobody contends for proves nothing. The four races in that file — two
 * owners revoking each other, two organizations claiming one account, a
 * token exchange against a revoke, a tool commit against a token revocation
 * — need real backends contending for the same locks.
 *
 * WHY EMBEDDED. Nothing here touches a Supabase project or .env.local: a
 * fresh PostgreSQL is initialised in a temp directory, migrated exactly the
 * way the PGlite suites migrate (stub auth schema, every file in
 * supabase/migrations/, then the rollout follow-up so a second organization
 * can exist), used once, stopped and deleted. `embedded-postgres` downloads
 * the server binaries for this platform; it is deliberately not a
 * devDependency, because every `npm install` would otherwise pull ~40 MB of
 * binaries for a check that runs on demand.
 *
 * Usage:
 *   npm install --no-save embedded-postgres    # once per machine
 *   npm run test:postgres
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let EmbeddedPostgres
try {
  ;({ default: EmbeddedPostgres } = await import('embedded-postgres'))
} catch {
  console.error('\n[khyte] embedded-postgres is not installed. Run `npm install --no-save embedded-postgres` once, then retry.\n')
  process.exit(1)
}

const PORT = Number(process.env.PG_CONCURRENCY_PORT ?? 54329)
const dataDir = join(tmpdir(), `khyte-pg-${process.pid}`)
rmSync(dataDir, { recursive: true, force: true })

const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
  initdbFlags: ['--locale=C', '-E', 'UTF8'],
})

let status = 1
try {
  await server.initialise()
  await server.start()
  await server.createDatabase('khyte_test')
  const url = `postgres://postgres:postgres@127.0.0.1:${PORT}/khyte_test`

  // The same shape tests/support/migrations.ts gives PGlite: a stub of the
  // parts of Supabase the migrations reference, every migration in order,
  // then the rollout follow-up from wherever it currently lives.
  const sql = postgres(url, { max: 1 })
  try {
    await sql.unsafe(`create role anon; create role authenticated; create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`)
    const files = (dir) => {
      let names
      try {
        names = readdirSync(join(root, dir))
      } catch (error) {
        // The directory may not exist at all once the follow-up has been promoted.
        if (error.code !== 'ENOENT') throw error
        return []
      }
      return names.filter((f) => f.endsWith('.sql')).sort().map((f) => join(root, dir, f))
    }
    // Both follow-ups are excluded from the ordinary loop wherever they sort,
    // the way tests/support/migrations.ts excludes them: a promoted file must
    // not be applied as if it were a migration, and a migration sorting after
    // one still has to run. The rollout cleanup is then applied deliberately
    // below; the notes drop is NOT — this suite exercises the lock protocol and
    // has no reason to be without public.notes.
    const cleanup = (name) => name.endsWith('drop_organization_rollout.sql')
    const notesDrop = (name) => name.endsWith('drop_notes.sql')
    for (const file of files('supabase/migrations').filter((f) => !cleanup(f) && !notesDrop(f))) await sql.unsafe(readFileSync(file, 'utf8'))
    const followups = [...files('supabase/followups'), ...files('supabase/migrations')].filter(cleanup)
    if (followups.length === 0) throw new Error('rollout follow-up not found in supabase/followups or supabase/migrations')
    await sql.unsafe(readFileSync(followups[0], 'utf8'))
    const [{ version }] = await sql`select version()`
    console.log(`[khyte] migrated a disposable ${version.split(',')[0]} on port ${PORT}`)
  } finally {
    await sql.end()
  }

  const run = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', '--test', 'tests/mcp-postgres.test.ts'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, MCP_TEST_DATABASE_URL: url } }
  )
  status = run.status ?? 1
} finally {
  try {
    await server.stop()
  } catch {
    // Already down, or never came up; the directory goes either way.
  }
  rmSync(dataDir, { recursive: true, force: true })
}
process.exit(status)
