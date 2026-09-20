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
 * the person's sessions and MCP connections in the same transaction. A plain
 * .mjs cannot import the TypeScript modules, so keep the three in step.
 *
 * THE ACCOUNT IS GLOBAL; THE OWNER IS NOT. One Supabase Auth login serves
 * every organization a person belongs to, while an owner's authority stops at
 * their own roster. So an account is administered from here — attached,
 * given a new password — only while the organization being acted on is that
 * account's sole active home. An account that is active somewhere else is
 * refused by both `add` and `reset-password`: joining a further organization
 * waits for an invitation the person accepts themselves (a later stage), and
 * a shared account's password is theirs to change. Without that line, whoever
 * administers one organization could replace a shared password and walk into
 * the other organization as that person — and this script answers to nothing
 * but a connection string.
 *
 * ADDING ALWAYS HANDS OVER A WAY IN. An account that already exists has its
 * password replaced too, rather than left alone: "on the roster with no way
 * in" was the state that used to result, and the person running this has
 * something to hand over either way. Whatever the old password opened closes
 * with it — every session of that account, in every organization. And every
 * refusal is decided before an account is created or touched, so a refused
 * add leaves nothing behind: no orphan account whose password nobody saw.
 *
 * NEVER GUESSES. --email is required by every command that touches a person;
 * there is no positional fallback, no prompt, no "the only member". The
 * roster label is mapped only when --colleague says so — never from a name.
 *
 * NEVER PRINTS A SECRET, with one exception: a temporary password this run
 * just generated, shown once so it can be handed over. A password given with
 * --password is never echoed. Connection strings and keys stay in .env.local.
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
 */
async function hasActiveMembershipElsewhere(userId, orgId) {
  const [row] = await sql`
    select id from organization_members
    where user_id = ${userId} and organization_id <> ${orgId} and status = 'active' limit 1`
  return Boolean(row)
}

/**
 * The checks `add` will make again inside its transaction, run here ahead of
 * creating an account or replacing a password so a refusal leaves nothing
 * behind. Mirrors assertCanAddMember in lib/org/members.ts: this is not the
 * guard — the locked rows and the unique indexes are — only the early answer.
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
  let generated = null

  // Everything that can refuse this add is decided first — before an account
  // is created and before an existing one's password is replaced — so a
  // refusal leaves no orphan account and no password nobody was shown.
  if (account && (await hasActiveMembershipElsewhere(account.id, org.id))) {
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

  if (account) {
    // The account exists and belongs nowhere else, so this organization may
    // hand over a way in: replace the password rather than add someone who
    // cannot log in. Whatever the old one opened closes with it — every
    // session of the account, in every organization, the way
    // revokeSessionsForUser in lib/org/members.ts does it.
    const { error } = await adminAuth().updateUserById(account.id, { password })
    if (error) refuse(`The password could not be replaced: ${error.message}.`)
    const sessions = await sql`
      update app_sessions set revoked_at = now()
      where user_id = ${account.id} and revoked_at is null`
    console.log(
      `\n[khyte] ${email} already had an account: its password was replaced and ${sessions.count} session(s) cut.`
    )
  } else {
    // Unknown email: create the account the way app/actions/members.ts does —
    // confirmed up front, because whoever runs this has vouched for the
    // address and the app sends no email.
    const { data, error } = await adminAuth().createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    })
    if (error || !data?.user) refuse(`The account could not be created: ${error?.message ?? 'no user returned'}.`)
    account = { id: data.user.id, email }
    console.log(`\n[khyte] Created the account for ${email}.`)
  }

  const member = await sql.begin(async (tx) => {
    // Mirrors addMember in lib/org/members.ts: one membership per account per
    // organization, reactivated rather than duplicated; an active one is
    // refused because the caller meant to edit, not add.
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
          set status = 'active', revoked_at = null, role = ${role}, email = ${account.email}, display_name = ${displayName}, colleague = ${colleague}
          where id = ${existing.id} and organization_id = ${org.id}
          returning id`
      : await tx`
          insert into organization_members (organization_id, user_id, role, email, display_name, colleague)
          values (${org.id}, ${account.id}, ${role}, ${account.email}, ${displayName}, ${colleague})
          returning id`
    return { id: row.id, reactivated: Boolean(existing) }
  })

  console.log(
    `\n[khyte] ${member.reactivated ? 'Reactivated' : 'Added'} ${displayName} <${email}> as ${role} of ${org.name}` +
      `${colleague ? `, known on the roster as "${colleague}"` : ''}.\n`
  )
  if (generated) showOnce(generated)
}

async function revoke(org) {
  const account = await findAccount(email)
  if (!account) refuse(`No account has the email ${email}.`)

  await sql.begin(async (tx) => {
    // Mirrors revokeMember in lib/org/members.ts, in one transaction: the
    // membership, every browser session of that person in this organization,
    // and every MCP connection they approved for it. Leaving any of those
    // would leave a person with access the roster says they no longer have.
    const [member] = await tx`
      select id, user_id, role, status from organization_members
      where organization_id = ${org.id} and user_id = ${account.id} for update`
    if (!member) refuse(`${email} is not a member of ${org.name}.`)
    if (member.status === 'revoked') {
      console.log(`\n[khyte] ${email} is already revoked in ${org.name}. Nothing to do.\n`)
      return
    }
    if (member.role === 'owner') {
      const [{ n }] = await tx`
        select count(*)::int as n from organization_members
        where organization_id = ${org.id} and role = 'owner' and status = 'active'`
      if (Number(n) <= 1) {
        refuse(`${email} is the last active owner of ${org.name}. Add another owner first — an organization nobody can administer is a dead end.`)
      }
    }
    await tx`
      update organization_members set status = 'revoked', revoked_at = now()
      where id = ${member.id} and organization_id = ${org.id}`
    const sessions = await tx`
      update app_sessions set revoked_at = now()
      where user_id = ${member.user_id} and organization_id = ${org.id} and revoked_at is null`
    const connections = await tx`
      update crm_oauth_connections set revoked_at = now()
      where user_id = ${member.user_id} and organization_id = ${org.id} and revoked_at is null`
    console.log(
      `\n[khyte] Revoked ${email} from ${org.name}: ${sessions.count} session(s) and ${connections.count} MCP connection(s) cut.\n`
    )
  })
}

async function resetPassword(org) {
  const account = await findAccount(email)
  if (!account) refuse(`No account has the email ${email}.`)
  // Only an active member of THIS organization, mirroring findActiveMember:
  // a revoked person does not get a fresh way in through a password reset,
  // and an account outside the organization is none of its owners' business.
  const [member] = await sql`
    select display_name from organization_members
    where organization_id = ${org.id} and user_id = ${account.id} and status = 'active'`
  if (!member) refuse(`${email} is not an active member of ${org.name}. Reactivate them with add first.`)
  // A password that also opens another organization is the person's to
  // change, not this one's — see the header. Refused rather than narrowed,
  // because there is no such thing as a password that works in one
  // organization only.
  if (await hasActiveMembershipElsewhere(account.id, org.id)) {
    refuse(
      `${email} is also an active member of another organization, so this password is not ${org.name}'s to replace.\n` +
        '  Ask them to change it themselves; the account is global and this organization is not its owner.'
    )
  }

  const password = temporaryPassword()
  const { error } = await adminAuth().updateUserById(account.id, { password })
  if (error) refuse(`The password could not be replaced: ${error.message}.`)
  // A reset is done because the old credential may be in the wrong hands, so
  // whatever it already opened is closed with it: every session of the
  // account — in every organization, since the password was global too — and
  // every MCP connection it approved for this organization.
  const sessions = await sql`
    update app_sessions set revoked_at = now()
    where user_id = ${account.id} and revoked_at is null`
  const connections = await sql`
    update crm_oauth_connections set revoked_at = now()
    where user_id = ${account.id} and organization_id = ${org.id} and revoked_at is null`
  console.log(
    `\n[khyte] Replaced the password for ${member.display_name} <${email}>: ` +
      `${sessions.count} session(s) and ${connections.count} MCP connection(s) cut.`
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
  // Missing keys are found before anything is written, not after.
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
      : `${command} failed: ${cause instanceof Error ? cause.message : String(cause)}`
  console.error(`\n[khyte] ${message}\n`)
  exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
process.exit(exitCode)
