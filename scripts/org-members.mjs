/**
 * Manages who belongs to an organization, from the terminal.
 *
 * WHY A SCRIPT WHEN SETTINGS HAS A MEMBERS PANEL. The panel is owner-only,
 * and an owner has to exist before anyone can log in at all: the migration
 * that created organizations deliberately created no accounts, because which
 * email is Erik and which is Abdi is a fact only the team knows. This is how
 * the first owner is made, how a locked-out owner is rescued, and how the
 * roster is inspected without a browser.
 *
 * SAME RULES AS THE APP. Every rule in lib/org/members.ts and
 * app/actions/members.ts is mirrored here: one membership per account per
 * organization (a revoked one is reactivated, never duplicated), one active
 * member per roster label, never zero active owners, and a revocation cuts
 * the person's sessions, MCP connections and pending codes in the same
 * transaction. A plain .mjs cannot import the TypeScript modules, so keep the
 * three in step.
 *
 * TWO LOCKS, ALWAYS ORGANIZATION THEN ACCOUNT. Every command that writes does
 * it in one transaction that first takes
 *
 *     select pg_advisory_xact_lock(hashtext('khyte:org:<organization id>'))
 *     select pg_advisory_xact_lock(hashtext('khyte:user:<account id>'))
 *
 * — the same two locks, in the same order, as lib/org/members.ts. The
 * organization lock serializes the owner count against another owner acting
 * at the same moment; the account lock serializes administering one account,
 * a question that spans organizations and therefore cannot be settled by a
 * row lock inside one roster. This script races the running app exactly the
 * way a second owner does, so taking the two in the other order here would
 * deadlock against it rather than protect anything.
 *
 * CREDENTIAL GENERATION. Wallpaper links, OAuth codes and MCP connections all
 * record organization_members.credential_generation when they are minted, and
 * are refused once it no longer matches. Revoking, reactivating and resetting
 * a password each rotate it here, exactly as the app does, so a credential
 * copied before any of those cannot come back to life when the same
 * membership row is active again. Sessions and pending codes are plain rows,
 * and are revoked or deleted outright.
 *
 * THE ACCOUNT IS GLOBAL; THE OWNER IS NOT. One Supabase Auth login serves
 * every organization a person belongs to, while an owner's authority stops at
 * their own roster. So an account is administered from here — attached,
 * given a new password — only while the organization being acted on is that
 * account's sole active home, which is asked again under the account lock and
 * not only up front. An account that is active somewhere else is refused by
 * both `add` and `reset-password`: joining a further organization waits for an
 * invitation the person accepts themselves (a later stage), and a shared
 * account's password is theirs to change. Without that line, whoever
 * administers one organization could replace a shared password and walk into
 * the other organization as that person — and this script answers to nothing
 * but a connection string.
 *
 * ADDING ALWAYS HANDS OVER A WAY IN. An account that already exists has its
 * password replaced too, rather than left alone: "on the roster with no way
 * in" was the state that used to result, and the person running this has
 * something to hand over either way. Whatever the old password opened closes
 * with it — every session of that account in every organization, and every
 * authorization code approved but not yet exchanged. And every refusal is
 * decided before an account is created or touched, so a refused add leaves
 * nothing behind: no orphan account whose password nobody saw.
 *
 * THE ONE CALL A TRANSACTION CANNOT UNDO is the one to Supabase Auth that
 * replaces a password. It is made inside the transaction and after the
 * membership write, the way claimAccount orders it, so everything that can
 * refuse this run rolls back with the password untouched. If that call
 * succeeds and a later step or the commit then fails, the account has a new
 * password and nothing was saved — the run says exactly that, and says to run
 * the same command again, which issues a fresh password and completes.
 *
 * NEVER GUESSES. --email is required by every command that touches a person;
 * there is no positional fallback, no prompt, no "the only member". The
 * roster label is mapped only when --colleague says so — never from a name.
 *
 * NEVER PRINTS A SECRET, with one exception: a temporary password this run
 * just generated, shown once and only after the commit, so it can be handed
 * over. A password given with --password is never echoed. Connection strings
 * and keys stay in .env.local.
 *
 * Usage:
 *   npm run org:members -- list
 *   npm run org:members -- add --email erik@khyte.se --name "Erik" --role owner --colleague erik
 *   npm run org:members -- add --email anna@khyte.se --name "Anna" [--password <p>]
 *   npm run org:members -- revoke --email anna@khyte.se
 *   npm run org:members -- reset-password --email anna@khyte.se
 *
 * Every command takes --org <uuid> to act on an organization other than Khyte.
 */
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { readEnvLocal } from './supabase.mjs'

/** Fixed in supabase/migrations/20260920120000_organizations.sql. */
const KHYTE = '7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10'
const COMMANDS = ['list', 'add', 'revoke', 'reset-password']
const ROLES = ['owner', 'member']
/** The legacy roster (crm_colleague). Duplicated from lib/types/index.ts
 *  because a plain .mjs cannot import the TypeScript module; keep in step. */
const COLLEAGUES = ['erik', 'abdi', 'hai']
const FLAGS = ['email', 'name', 'role', 'colleague', 'password', 'org']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The nil-shaped uuid lib/org/members.ts uses when there is no row to exclude. */
const NO_MEMBER = '00000000-0000-4000-8000-000000000000'

const USAGE =
  '\n  npm run org:members -- list\n' +
  '  npm run org:members -- add --email <e> --name <n> [--role owner|member] [--colleague erik|abdi|hai] [--password <p>]\n' +
  '  npm run org:members -- revoke --email <e>\n' +
  '  npm run org:members -- reset-password --email <e>\n' +
  '\n  Every command accepts --org <uuid>; the default is Khyte.'

function fail(message) {
  console.error(`\n[khyte] ${message}\n`)
  process.exit(1)
}

/**
 * A refusal with a reason the person can act on — the request was wrong, not
 * the database. Thrown inside a transaction it rolls the transaction back;
 * caught at the bottom it is printed without a stack trace.
 */
class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message)
}

/** What a thrown thing has to say for itself, for a message that quotes it. */
const reasonOf = (cause) => (cause instanceof Error ? cause.message : String(cause))

// --- arguments ---------------------------------------------------------------
//
// Every value is named. Positional arguments would make `add erik@… Erik`
// and `add Erik erik@…` both look plausible and one of them silently wrong.

function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!command || !COMMANDS.includes(command)) {
    fail(`${command ? `Unknown command "${command}".` : 'Which command?'}${USAGE}`)
  }
  const flags = {}
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]
    const value = rest[i + 1]
    if (!flag.startsWith('--') || !FLAGS.includes(flag.slice(2))) {
      fail(`Unexpected argument "${flag}". Every value is named: ${FLAGS.map((f) => `--${f}`).join(', ')}.`)
    }
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value.`)
    flags[flag.slice(2)] = value
  }
  return { command, flags }
}

const { command, flags } = parseArgs(process.argv.slice(2))

const email = flags.email?.trim().toLowerCase()
if (command !== 'list' && !email) fail(`${command} needs --email. It is never inferred.${USAGE}`)
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${flags.email}" does not look like an email address.`)
if (command === 'list' && email) fail('list takes no --email; it shows the whole roster.')

const orgId = (flags.org ?? KHYTE).toLowerCase()
if (!UUID.test(orgId)) fail('--org must be an organization id (a uuid).')

const role = flags.role ?? 'member'
if (!ROLES.includes(role)) fail(`--role must be one of: ${ROLES.join(', ')}.`)

const colleague = flags.colleague ?? null
if (colleague !== null && !COLLEAGUES.includes(colleague)) fail(`--colleague must be one of: ${COLLEAGUES.join(', ')}.`)

const displayName = flags.name?.trim()
if (command === 'add' && !displayName) fail('add needs --name: the name colleagues will see.')
if (displayName && displayName.length > 80) fail('--name is at most 80 characters.')
if (command !== 'add' && (flags.name || flags.role || flags.colleague || flags.password)) {
  fail(`${command} takes only --email (and --org). Roles and labels are edited from Settings.`)
}
if (flags.password !== undefined && !flags.password) fail('--password cannot be empty. Leave it out to have one generated.')

// --- connections -------------------------------------------------------------

const env = readEnvLocal()
if (!env.SUPABASE_DB_URL) {
  fail(
    'SUPABASE_DB_URL must be set in .env.local — without a database there is\n' +
      '  no roster. See .env.example.'
  )
}

// One connection and no prepared statements: a one-shot script against the
// session pooler, whose per-project cap lib/db/pg.ts explains.
const sql = postgres(env.SUPABASE_DB_URL, { max: 1, prepare: false })

/**
 * The admin API — creating an account, replacing a password — is only opened
 * by the commands that need it. A listing or a revoke reaches nothing but the
 * database, so those work with SUPABASE_DB_URL alone.
 */
let admin = null
function adminAuth() {
  if (admin) return admin
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    refuse(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local\n' +
        '  to create accounts or replace passwords. See .env.example.'
    )
  }
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin
  return admin
}

/** Sixteen base64url characters — the same shape app/actions/members.ts hands out. */
const temporaryPassword = () => randomBytes(12).toString('base64url')

/** The one secret this script ever prints, and only because it just made it. */
function showOnce(password) {
  console.log('\n[khyte] Temporary password — shown once, stored nowhere here:\n')
  console.log(`    ${password}\n`)
  console.log('  Hand it over in person. They can change it once logged in.\n')
}

// --- locks -------------------------------------------------------------------
//
// lockOrganization then lockAccount, never the other way round — see the
// header. Both are transaction-scoped, so the commit or the rollback releases
// them and there is nothing to unlock by hand; both therefore only mean
// anything when handed a `tx` from sql.begin.
//
// The call to Supabase Auth that replaces a password is made while both are
// held, as it is in lib/org/members.ts: nothing else may administer the
// account between the membership write and the new password. The cost is that
// a hung call keeps other writers to this organization waiting, which is the
// right trade for a command run by hand, a few times a year.

/** Serializes every change to one organization's roster. Take before lockAccount. */
const lockOrganization = (tx, organizationId) =>
  tx`select pg_advisory_xact_lock(hashtext(${`khyte:org:${organizationId}`}))`

/** Serializes every administration of one account, across organizations. */
const lockAccount = (tx, userId) => tx`select pg_advisory_xact_lock(hashtext(${`khyte:user:${userId}`}))`

// --- reads -------------------------------------------------------------------

/**
 * The account behind an email, read straight from the auth schema — the same
 * lookup as findAccountByEmail in lib/auth/identity.ts. Case-insensitive,
 * matching how GoTrue treats addresses.
 */
async function findAccount(address) {
  const [row] = await sql`select id, email from auth.users where lower(email) = lower(${address}) limit 1`
  return row ?? null
}

/**
 * Whether the account is an active member of any organization but this one —
 * mirroring hasActiveMembershipElsewhere in lib/org/members.ts. The other
 * organization is not named: that one exists is the whole of the answer, and
 * it is what decides whether this organization may touch the account at all.
 *
 * Takes the connection to ask on, because it is asked twice: once up front,
 * where a refusal is cheap, and once under the account lock, where it is the
 * guard rather than the guess.
 */
async function hasActiveMembershipElsewhere(db, userId, organizationId) {
  const [row] = await db`
    select id from organization_members
    where user_id = ${userId} and organization_id <> ${organizationId} and status = 'active' limit 1`
  return Boolean(row)
}

/**
 * The checks `add` will make again inside its transaction, run here ahead of
 * creating an account so a refusal leaves nothing behind. Mirrors
 * assertCanAddMember in lib/org/members.ts: this is not the guard — the locks,
 * the locked rows and the unique indexes are — only the early answer.
 *
 * `userId` is null for an email with no account yet, in which case any active
 * holder of the roster label is somebody else by definition.
 */
async function assertCanAddMember(org, userId) {
  if (userId) {
    const [existing] = await sql`
      select status from organization_members where organization_id = ${org.id} and user_id = ${userId}`
    if (existing?.status === 'active') {
      refuse(`${email} is already an active member of ${org.name}. Edit them from Settings, or revoke first.`)
    }
  }
  if (colleague) {
    const [taken] = await sql`
      select user_id, email from organization_members
      where organization_id = ${org.id} and colleague = ${colleague} and status = 'active'`
    if (taken && taken.user_id !== userId) {
      refuse(`The roster label "${colleague}" is already carried by ${taken.email}. One active member per label.`)
    }
  }
}

// --- credential revocation ---------------------------------------------------
//
// The same three cuts lib/org/members.ts makes, and for the same reason:
// revoking a membership, or a password, without cutting everything that acts
// as it would leave a person with access the roster says they no longer have.

/** Ends every browser session of one account, in every organization. */
async function revokeSessionsForUser(tx, userId) {
  const result = await tx`
    update app_sessions set revoked_at = now()
    where user_id = ${userId} and revoked_at is null`
  return result.count
}

/** Ends every MCP connection one account approved for one organization. */
async function revokeConnectionsForUser(tx, userId, organizationId) {
  const result = await tx`
    update crm_oauth_connections set revoked_at = now()
    where user_id = ${userId} and organization_id = ${organizationId} and revoked_at is null`
  return result.count
}

/**
 * Throws away authorization codes one account has approved but not yet
 * exchanged — in one organization, or everywhere when `organizationId` is
 * null. A code lives five minutes; a person removed or reset inside those
 * minutes must not be able to finish connecting afterwards.
 */
async function discardCodesForUser(tx, userId, organizationId) {
  const result = await tx`
    delete from crm_oauth_codes
    where user_id = ${userId} and (${organizationId}::uuid is null or organization_id = ${organizationId})`
  return result.count
}

// --- commands ----------------------------------------------------------------

async function list(org) {
  const members = await sql`
    select email, display_name, role, status, colleague, revoked_at
    from organization_members
    where organization_id = ${org.id}
    order by status = 'active' desc, role = 'owner' desc, created_at asc`
  console.log(`\n[khyte] ${org.name} — ${members.length} member${members.length === 1 ? '' : 's'}\n`)
  if (!members.length) console.log('  Nobody yet. Add the first owner with `add --role owner`.')
  for (const m of members) {
    const state = m.status === 'active'
      ? 'active'
      : `revoked${m.revoked_at ? ` ${new Date(m.revoked_at).toISOString().slice(0, 10)}` : ''}`
    console.log(`  ${m.email.padEnd(32)} ${m.display_name.padEnd(24)} ${m.role.padEnd(7)} ${(m.colleague ?? '—').padEnd(5)} ${state}`)
  }
  console.log('')
}

async function add(org) {
  let account = await findAccount(email)
  const existingAccount = Boolean(account)
  let generated = null
  let accountCreated = false
  let passwordReplaced = false

  // Everything that can refuse this add is asked first — before an account is
  // created and before any password is replaced — so a refusal leaves no
  // orphan account and no password nobody was shown. These two are the early
  // answer, not the guard: the transaction asks them again under its locks.
  if (account && (await hasActiveMembershipElsewhere(sql, account.id, org.id))) {
    refuse(
      `${email} is an active member of another organization, so ${org.name} cannot attach that account.\n` +
        '  Accounts are global; a roster is not. Joining a further organization waits for an invitation\n' +
        '  the person accepts themselves, which is a later stage.'
    )
  }
  await assertCanAddMember(org, account?.id ?? null)

  // The password given or a fresh temporary one — shown once at the end, and
  // only if this run generated it.
  const password = flags.password ?? (generated = temporaryPassword())

  if (!account) {
    // Unknown email: create the account the way app/actions/members.ts does —
    // confirmed up front, because whoever runs this has vouched for the
    // address and the app sends no email. The password is set at creation, so
    // the transaction below has none to replace, and a brand-new account has
    // no session, connection or code of its own to cut.
    const { data, error } = await adminAuth().createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })
    if (error || !data?.user) refuse(`The account could not be created: ${error?.message ?? 'no user returned'}.`)
    account = { id: data.user.id, email }
    accountCreated = true
    console.log(`\n[khyte] Created the account for ${email}.`)
  }

  let outcome
  try {
    outcome = await sql.begin(async (tx) => {
      // claimAccount in lib/org/members.ts, step for step: both locks, then
      // the question of where this account belongs, then the membership, then
      // the password, then the cuts.
      await lockOrganization(tx, org.id)
      await lockAccount(tx, account.id)

      // Asked again here because the answer can change between the early check
      // and this moment: another organization claiming the same account is
      // serialized behind this same lock, and one of the two has to lose.
      if (await hasActiveMembershipElsewhere(tx, account.id, org.id)) {
        refuse(
          `${email} became an active member of another organization while this add was running,\n` +
            `  so ${org.name} cannot attach that account. Nothing was changed.`
        )
      }

      // One membership per account per organization, reactivated rather than
      // duplicated; an active one is refused because the caller meant to edit,
      // not add. Reactivation rotates the credential generation, so nothing
      // minted before the revoke comes back to life with the row.
      const [existing] = await tx`
        select id, status from organization_members
        where organization_id = ${org.id} and user_id = ${account.id} for update`
      if (existing?.status === 'active') {
        refuse(`${email} is already an active member of ${org.name}. Edit them from Settings, or revoke first.`)
      }
      if (colleague) {
        const [taken] = await tx`
          select email from organization_members
          where organization_id = ${org.id} and colleague = ${colleague} and status = 'active' and id <> ${existing?.id ?? NO_MEMBER}`
        if (taken) refuse(`The roster label "${colleague}" is already carried by ${taken.email}. One active member per label.`)
      }
      const [row] = existing
        ? await tx`
            update organization_members
            set status = 'active', revoked_at = null, role = ${role}, email = ${account.email}, display_name = ${displayName}, colleague = ${colleague},
                credential_generation = gen_random_uuid()
            where id = ${existing.id} and organization_id = ${org.id}
            returning id`
        : await tx`
            insert into organization_members (organization_id, user_id, role, email, display_name, colleague)
            values (${org.id}, ${account.id}, ${role}, ${account.email}, ${displayName}, ${colleague})
            returning id`

      // The password comes after the membership write and before the cuts,
      // exactly as claimAccount orders it: everything that can refuse this add
      // has refused by now, so a rollback from here on is the rare case the
      // catch below reports rather than an ordinary one. An account created a
      // moment ago already carries this password and is left alone.
      if (existingAccount) {
        const { error } = await adminAuth().updateUserById(account.id, { password })
        if (error) refuse(`The password could not be replaced: ${error.message}.`)
        passwordReplaced = true
      }

      // Whatever the old password opened closes with it: every session of the
      // account, in every organization, and every code approved but not yet
      // exchanged, anywhere. Both are no-ops for an account just created.
      const sessions = await revokeSessionsForUser(tx, account.id)
      const codes = await discardCodesForUser(tx, account.id, null)
      return { id: row.id, reactivated: Boolean(existing), sessions, codes }
    })
  } catch (cause) {
    // The two states a rollback cannot repair, because they live in Supabase
    // Auth and not in this database. Both are survivable, and both are
    // repaired by running the same add again — which finds the account this
    // run left behind, replaces its password, and saves the membership.
    if (passwordReplaced) {
      refuse(
        `The password for ${email} was replaced, but the membership was NOT saved: ${reasonOf(cause)}\n` +
          `  Nothing else changed — the roster of ${org.name} is as it was, and no session was cut.\n` +
          `  ${generated
            ? 'The password this run generated was never printed, so nobody has it.'
            : 'The account now carries the password passed with --password.'}\n` +
          '  Run the same add again: it saves the membership and issues a fresh password.'
      )
    }
    if (accountCreated) {
      refuse(
        `The account for ${email} was created, but the membership was NOT saved: ${reasonOf(cause)}\n` +
          '  The account exists with a password that was never printed, and belongs to no organization.\n' +
          '  Run the same add again: it finds that account, issues a fresh password and saves the membership.'
      )
    }
    throw cause
  }

  // Printed only now: before the commit these counts are a claim, not a fact.
  console.log(
    `\n[khyte] ${outcome.reactivated ? 'Reactivated' : 'Added'} ${displayName} <${email}> as ${role} of ${org.name}` +
      `${colleague ? `, known on the roster as "${colleague}"` : ''}.\n`
  )
  if (existingAccount) {
    console.log(
      `  ${email} already had an account: its password was replaced, ${outcome.sessions} session(s) cut\n` +
        `  and ${outcome.codes} pending MCP code(s) discarded.\n`
    )
  }
  if (generated) showOnce(generated)
}

async function revoke(org) {
  const account = await findAccount(email)
  if (!account) refuse(`No account has the email ${email}.`)

  const outcome = await sql.begin(async (tx) => {
    // revokeMember in lib/org/members.ts, in one transaction under both locks:
    // the membership, every browser session of that person in this
    // organization, every MCP connection they approved for it, every code they
    // have not yet exchanged for it, and — through the rotated generation —
    // every wallpaper link they minted. Leaving any of those would leave a
    // person with access the roster says they no longer have.
    await lockOrganization(tx, org.id)
    const [member] = await tx`
      select id, user_id, role, status from organization_members
      where organization_id = ${org.id} and user_id = ${account.id} for update`
    if (!member) refuse(`${email} is not a member of ${org.name}.`)
    if (member.status === 'revoked') return null
    // Taken after the row is read, the way revokeMember does it: a token
    // exchange or tool commit in flight for this person either finishes before
    // this revoke and is then cut, or waits here and finds the membership gone.
    await lockAccount(tx, member.user_id)

    if (member.role === 'owner') {
      const [{ n }] = await tx`
        select count(*)::int as n from organization_members
        where organization_id = ${org.id} and role = 'owner' and status = 'active'`
      if (Number(n) <= 1) {
        refuse(`${email} is the last active owner of ${org.name}. Add another owner first — an organization nobody can administer is a dead end.`)
      }
    }
    await tx`
      update organization_members
      set status = 'revoked', revoked_at = now(), credential_generation = gen_random_uuid()
      where id = ${member.id} and organization_id = ${org.id}`
    const sessions = await tx`
      update app_sessions set revoked_at = now()
      where user_id = ${member.user_id} and organization_id = ${org.id} and revoked_at is null`
    const connections = await revokeConnectionsForUser(tx, member.user_id, org.id)
    const codes = await discardCodesForUser(tx, member.user_id, org.id)
    return { sessions: sessions.count, connections, codes }
  })

  if (!outcome) {
    console.log(`\n[khyte] ${email} is already revoked in ${org.name}. Nothing to do.\n`)
    return
  }
  // Printed after the commit, for the same reason add prints there: counts a
  // rollback would have turned into a lie.
  console.log(
    `\n[khyte] Revoked ${email} from ${org.name}: ${outcome.sessions} session(s), ` +
      `${outcome.connections} MCP connection(s) and ${outcome.codes} pending code(s) cut.\n` +
      "  The membership's credential generation was rotated, so every wallpaper link\n" +
      '  they minted is dead too.\n'
  )
}

async function resetPassword(org) {
  const account = await findAccount(email)
  if (!account) refuse(`No account has the email ${email}.`)

  const password = temporaryPassword()
  let passwordReplaced = false

  let outcome
  try {
    outcome = await sql.begin(async (tx) => {
      // resetCredentials in lib/org/members.ts, step for step.
      await lockOrganization(tx, org.id)
      // Only an active member of THIS organization: a revoked person does not
      // get a fresh way in through a password reset, and an account outside
      // the organization is none of its owners' business.
      const [member] = await tx`
        select id, user_id, display_name from organization_members
        where organization_id = ${org.id} and user_id = ${account.id} and status = 'active' for update`
      if (!member) refuse(`${email} is not an active member of ${org.name}. Reactivate them with add first.`)
      await lockAccount(tx, member.user_id)

      // A password that also opens another organization is the person's to
      // change, not this one's — see the header. Refused rather than narrowed,
      // because there is no such thing as a password that works in one
      // organization only.
      if (await hasActiveMembershipElsewhere(tx, member.user_id, org.id)) {
        refuse(
          `${email} is also an active member of another organization, so this password is not ${org.name}'s to replace.\n` +
            '  Ask them to change it themselves; the account is global and this organization is not its owner.'
        )
      }

      // The generation is rotated before the external call, so that even a
      // failure after it leaves no wallpaper link, code or connection minted
      // under the old credential usable.
      await tx`update organization_members set credential_generation = gen_random_uuid() where id = ${member.id}`
      const { error } = await adminAuth().updateUserById(member.user_id, { password })
      if (error) refuse(`The password could not be replaced: ${error.message}.`)
      passwordReplaced = true

      // A reset is done because the old credential may be in the wrong hands,
      // so whatever it already opened is closed with it: every session of the
      // account — in every organization, since the password was global too —
      // every MCP connection it approved for this organization, and every code
      // approved but not yet exchanged, anywhere.
      const sessions = await revokeSessionsForUser(tx, member.user_id)
      const connections = await revokeConnectionsForUser(tx, member.user_id, org.id)
      const codes = await discardCodesForUser(tx, member.user_id, null)
      return { displayName: member.display_name, sessions, connections, codes }
    })
  } catch (cause) {
    // The same line add draws, for the same reason: the call to Supabase Auth
    // is the one thing the rollback did not undo.
    if (passwordReplaced) {
      refuse(
        `The password for ${email} was replaced, but the reset was NOT saved: ${reasonOf(cause)}\n` +
          '  The password this run generated was never printed, so nobody has it, and the sessions,\n' +
          '  connections and pending codes it was meant to cut may still be live.\n' +
          '  Run reset-password again: it issues a fresh password and cuts them.'
      )
    }
    throw cause
  }

  console.log(
    `\n[khyte] Replaced the password for ${outcome.displayName} <${email}>: ${outcome.sessions} session(s), ` +
      `${outcome.connections} MCP connection(s) and ${outcome.codes} pending code(s) cut.\n` +
      '  The credential generation was rotated, so their wallpaper links are dead too.'
  )
  showOnce(password)
}

// --- run ---------------------------------------------------------------------

let exitCode = 0
try {
  // The organization is named up front so every message can say which one
  // it acted on — and so a mistyped --org fails here, before any write.
  const [org] = await sql`select id, name from organizations where id = ${orgId}`
  if (!org) refuse(`No organization has the id ${orgId}.`)
  // Missing keys are found before anything is written, not after — and before
  // a transaction is open, so no lock is ever held waiting on a refusal.
  if (command === 'add' || command === 'reset-password') adminAuth()
  await { list, add, revoke, 'reset-password': resetPassword }[command](org)
} catch (cause) {
  // A refusal is printed as the sentence it is. Anything else is a real
  // fault whose message may name a host or a table, never a credential —
  // neither postgres.js nor supabase-js echoes the secrets they hold.
  //
  // 42P01 (undefined_table) has one likely cause worth naming: the database
  // predates the organization migration. Migrations ship with their code, so
  // the fix is to push, not to work around it here.
  const message = cause instanceof Refusal
    ? cause.message
    : cause?.code === '42P01'
      ? 'The organization tables do not exist in this database yet. Apply\n' +
        '  supabase/migrations/20260920120000_organizations.sql with `npm run db:push` first.'
      : `${command} failed: ${reasonOf(cause)}`
  console.error(`\n[khyte] ${message}\n`)
  exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
process.exit(exitCode)
