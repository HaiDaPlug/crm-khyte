import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { readSql, rolloutCleanupPath } from './support/migrations'

/**
 * A LINT, NOT A PROOF.
 *
 * Every other suite proves behaviour: it writes through the real code and
 * asserts what the database ends up holding. This one reads source text and
 * checks that each statement touching an organization-owned table mentions
 * `organization_id` somewhere. That catches the one mistake the rest cannot
 * catch cheaply — a *new* query, added later, that forgets the scope — because
 * a behavioural test only covers the paths somebody remembered to write a test
 * for, and the forgotten query is by definition the one nobody did.
 *
 * What it cannot tell you: whether the organization mentioned is the caller's.
 * `organization_id = $2` bound to the wrong variable passes this and is a real
 * leak. It also says nothing about statements whose table name is interpolated
 * — those are counted and reported rather than checked. Read the counts each
 * run prints: they are the honest measure of how much this covers.
 *
 * The safety net underneath it is the database itself. Once the rollout
 * follow-up has run, `organization_id` is not-null with no default on all
 * nineteen tables, so a forgotten stamp on an insert fails loudly instead of
 * filing a row under Khyte. This lint is what catches a forgotten *filter* on
 * a read, which nothing else would.
 *
 * No .env files, remote database, production credentials, or network access.
 */

/* ———— reading source without being fooled by it ———— */

/** The end index of the string literal that starts at `start`. Escapes are
 *  skipped, and a template's `${…}` may hold strings of its own. */
function endOfString(source: string, start: number, quote: string): number {
  let i = start + 1
  while (i < source.length) {
    const c = source[i]
    if (c === '\\') { i += 2; continue }
    if (quote === '`' && c === '$' && source[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < source.length && depth > 0) {
        const d = source[i]
        if (d === '\\') { i += 2; continue }
        if (d === "'" || d === '"' || d === '`') { i = endOfString(source, i, d) + 1; continue }
        if (d === '{') depth += 1
        else if (d === '}') depth -= 1
        i += 1
      }
      continue
    }
    if (c === quote) return i
    i += 1
  }
  return source.length
}

/**
 * Every string literal in a TypeScript file, comments excluded.
 *
 * Comments are skipped first, so prose containing an apostrophe ("the
 * organization's rows") cannot be mistaken for the start of a string — and a
 * `//` inside a string is never reached, because the string is consumed whole
 * the moment its opening quote is seen. Regular expressions are the one shape
 * this does not model; the files it is pointed at contain none holding a quote
 * character, and `assertNoQuotedRegex` below keeps that true.
 */
function stringLiterals(source: string): string[] {
  const found: string[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(source, i, c)
      found.push(source.slice(i + 1, end))
      i = end + 1
      continue
    }
    i += 1
  }
  return found
}

/** A regex literal carrying a quote would desynchronise the scanner above.
 *  None of the files read here has one; this is what says so out loud. */
function assertNoQuotedRegex(file: string, source: string): void {
  for (const match of source.matchAll(/(?:^|[=(,:[!&|?{};+]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\n\\])+\/[dgimsuvy]*/g)) {
    assert.ok(!/['"`]/.test(match[0]), `${file}: a regex literal containing a quote would confuse this lint: ${match[0]}`)
  }
}

/** The matching `)` for the `(` at `open`, skipping over strings. */
function endOfCall(source: string, open: number): number {
  let depth = 0
  let i = open
  while (i < source.length) {
    const c = source[i]
    if (c === "'" || c === '"' || c === '`') { i = endOfString(source, i, c) + 1; continue }
    if (c === '(') depth += 1
    else if (c === ')') { depth -= 1; if (depth === 0) return i }
    i += 1
  }
  return source.length
}

/* ———— what counts as organization-owned ———— */

const MIGRATIONS = 'supabase/migrations'

/**
 * Every organization-owned table, from two sources, because neither alone is
 * the whole list.
 *
 * (a) The nineteen tables the rollout follow-up takes the default off — read
 * from that file rather than copied here, so the list cannot drift from the
 * schema. The count is asserted because that file is the rollout's own record:
 * a table quietly dropped from it is a table left with a default.
 *
 * (b) Every table whose `create table` block in supabase/migrations/ declares
 * an `organization_id` column. A table born *after* the rollout carries the
 * column from the start and needs no default taken off it, so it will never
 * appear in (a) — and read from (a) alone this lint would silently stop
 * covering every table added from here on. (b) is what makes a new table join
 * this lint the day its migration lands.
 */
async function organizationTables(): Promise<string[]> {
  const sql = await readSql(await rolloutCleanupPath())
  const tables = [...sql.matchAll(/alter table (?:public\.)?([a-z_]+)\s+alter column organization_id drop default/g)].map(m => m[1])
  assert.equal(tables.length, 19, 'the rollout follow-up must still name every organization-owned table')

  const owned = new Set(tables)
  for (const file of (await readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort()) {
    const migration = await readSql(`${MIGRATIONS}/${file}`)
    for (const match of migration.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(/gi)) {
      // The column list, to the end of the statement — so an `organization_id`
      // belonging to a *later* statement in the same file is not read as this
      // table's.
      const end = migration.indexOf(';', match.index)
      const body = migration.slice(match.index, end === -1 ? migration.length : end)
      if (body.includes('organization_id')) owned.add(match[1].toLowerCase())
    }
  }
  return [...owned].sort()
}

const ACTION_FILES = ['app/actions/crm.ts', 'app/actions/goals.ts']
const SQL_FILES = ['lib/db/queries.ts', 'lib/db/board-metrics.ts', 'lib/db/events.ts', 'lib/crm/service.ts', 'lib/mcp/export.ts', 'lib/journal/service.ts']

test('lint: every Server Action write names its organization in the chain it builds', async () => {
  const tables = await organizationTables()
  let checked = 0
  const seen = new Set<string>()

  for (const file of ACTION_FILES) {
    const source = await readFile(file, 'utf8')
    assertNoQuotedRegex(file, source)
    for (const match of source.matchAll(/\.from\((['"])([a-z_]+)\1\)/g)) {
      const start = match.index
      const table = match[2]
      // The chain, from `.from(` to the last `.method(…)` hanging off it —
      // insert object, .eq() filters, .upsert() conflict target and all.
      let i = start + match[0].length
      for (;;) {
        let j = i
        while (j < source.length && /\s/.test(source[j])) j += 1
        if (source[j] !== '.') break
        const call = /^\.[A-Za-z_$][\w$]*\s*\(/.exec(source.slice(j))
        if (!call) break
        i = endOfCall(source, j + call[0].length - 1) + 1
      }
      const chain = source.slice(start, i)
      seen.add(table)
      if (!tables.includes(table)) continue
      checked += 1
      assert.ok(chain.includes('organization_id'),
        `${file}: the ${table} statement at index ${start} names no organization_id:\n${chain}`)
    }
  }

  // Every table these two files touch is an organization-owned one. A table
  // here that is not would mean either the list has gone stale or a write has
  // found its way somewhere this lint does not think to look.
  for (const table of seen) {
    assert.ok(tables.includes(table), `${ACTION_FILES.join(' / ')}: ${table} is not one of the organization-owned tables`)
  }
  console.log(`[scoping] ${checked} Supabase statements checked across ${ACTION_FILES.length} Server Action files, ` +
    `over ${seen.size} tables, against ${tables.length} organization-owned tables`)
  // A floor, not a target: if the scanner above ever stops finding statements
  // — a syntax it cannot follow, a file renamed — this lint would pass by
  // checking nothing at all, which is the one way it could mislead.
  //
  // Re-based from 39 when createNote/updateNote/deleteNote left
  // app/actions/crm.ts for the Journal (Stage 2): 36 statements today, three
  // fewer than the 39 before, and a floor two below that so an ordinary edit
  // does not move it while a file dropping out still fails loudly.
  assert.ok(checked >= 34,
    `only ${checked} statements found, below the 34 expected of the two action files (36 today, after the three note actions moved to the Journal); the lint has stopped seeing the code`)
})

test('lint: every SQL statement against an organization-owned table names organization_id', async () => {
  const tables = await organizationTables()
  let checked = 0
  let interpolated = 0

  for (const file of SQL_FILES) {
    const source = await readFile(file, 'utf8')
    assertNoQuotedRegex(file, source)
    // File-local SQL fragments — `const filter = 'organization_id = $3 and …'`
    // — are substituted in, because a predicate kept in a constant and used by
    // two statements is still that statement's predicate.
    const fragments = new Map<string, string>()
    for (const m of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])((?:\\.|(?!\2).)*)\2/g)) fragments.set(m[1], m[3])
    const expand = (text: string) => text.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, name: string) => fragments.get(name) ?? all)

    for (const literal of stringLiterals(source)) {
      if (!/\b(from|update|insert\s+into)\s+/i.test(literal)) continue
      // A union is several statements in one string; each arm answers for
      // itself, or one forgetful arm would hide behind its neighbours.
      for (const segment of expand(literal).split(/\bunion(?:\s+all)?\b/i)) {
        const named = [...segment.matchAll(/\b(?:from|update|insert\s+into)\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase())
        interpolated += [...segment.matchAll(/\b(?:from|update|insert\s+into)\s+\$\{/gi)].length
        const owned = named.filter(name => tables.includes(name))
        if (!owned.length) continue
        checked += 1
        assert.ok(segment.includes('organization_id'),
          `${file}: a statement against ${owned.join(', ')} names no organization_id:\n${segment.trim()}`)
      }
    }
  }

  console.log(`[scoping] ${checked} SQL statements checked across ${SQL_FILES.length} files ` +
    `against ${tables.length} organization-owned tables; ` +
    `${interpolated} more have an interpolated table name and are covered by the helper check below, not by this one`)
  // Re-based twice: from 60 when lib/journal/service.ts joined SQL_FILES, and
  // again when the Journal reached lib/db/queries.ts — the two `notes`
  // statements (the snapshot read and its version arm) went, and
  // loadJournalVersion's three union arms arrived. 89 statements today, and a
  // floor two below that so an ordinary edit does not move it while a file
  // dropping out still fails loudly.
  assert.ok(checked >= 87,
    `only ${checked} statements found, below the 87 expected of the six files (89 today, 27 of them the Journal service); the lint has stopped seeing the code`)
})

test('lint: the service layer stamps and filters the organization in the helpers every plan goes through', async () => {
  // lib/crm/service.ts builds its writes through insert()/update(), whose
  // table name is a variable — so the statement check above cannot see them.
  // They are the only writers in that file, which is what makes stamping in
  // one place enough; these two assertions are what hold that.
  const source = await readFile('lib/crm/service.ts', 'utf8')
  const helper = (name: string) => {
    const start = source.indexOf(`function ${name}(plan: Plan`)
    assert.ok(start > 0, `lib/crm/service.ts must still declare ${name}(plan, …)`)
    const open = source.indexOf('{', source.indexOf(')', start))
    let depth = 0
    let i = open
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') { depth -= 1; if (depth === 0) break }
    }
    return source.slice(start, i)
  }
  assert.match(helper('insert'), /organization_id: plan\.actor\.organizationId/,
    'insert() must stamp the actor\'s organization on every row it writes')
  assert.match(helper('update'), /t\.organization_id = \$3[\s\S]*plan\.actor\.organizationId/,
    'update() must filter by the actor\'s organization')
  console.log('[scoping] 2 service-layer write helpers checked (insert, update)')
})
