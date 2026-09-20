# Organization foundation — Donna Stage 1

**Date:** 2026-09-20
**Branch:** `feat/organization-foundation`
**Blueprint:** [Donna-Product-Architecture-and-Fable-Handoff-v1.md](Donna-Product-Architecture-and-Fable-Handoff-v1.md), Section 13, Stage 1

This is the review handoff for the first stage of the Donna redesign: real
user identity and organization ownership across every access path, without
breaking the Khyte team's daily workflows. Nothing here adds Journal, capture
or AI behaviour; it is the ground those stand on.

Decisions taken with Hai before implementation:

| Decision | Choice |
| --- | --- |
| Identity provider | Supabase Auth holds accounts and passwords; the app mints its own revocable sessions |
| Legacy ChatGPT connections | Revoked by the migration; reconnect once after logging in with an account |
| Roster (erik / abdi / hai) | Stays as the attribution label on existing columns; a member is explicitly mapped to a label |
| Member management | Owner UI in Settings plus a CLI script; no invitation emails |

---

## What changed, in one paragraph

Every business and integration table now carries `organization_id`. A person
logs in with their own email and password, the app derives
`{ user, organization, membership }` from a server-side session, and that
context scopes every read, write, route, export, receipt, wallpaper link and
MCP tool. Cross-organization links are impossible at the database, not just
filtered in code. The shared password is gone.

---

## Data model

```
organizations            id, name, slug, timezone
organization_members     organization_id, user_id → auth.users, role (owner|member),
                         status (active|revoked), email, display_name,
                         colleague (crm_colleague, optional, unique per org while active)
app_sessions             user_id, organization_id, token_hash, expires_at, revoked_at

every business table     + organization_id  (not null, rollout default = Khyte)
crm_events               + recorded_by      (the account that logged it; `colleague` stays the roster label)
crm_oauth_codes          + user_id, organization_id
crm_oauth_connections    + user_id, organization_id   (legacy rows: user_id null → revoked)
```

The Khyte organization has a fixed id, `7b1e3d2a-8f4c-4a6e-9b21-0c5d3e7f9a10`,
so every environment that applies the migration agrees on it.

The migration file was edited after commit `977e05c` (credential
generation, member identity on codes and connections). That is safe only
because it had not been applied anywhere: `npm run db:status` against the
live project on 2026-09-20 listed `20260920120000_organizations.sql` as the
one pending migration. If it is ever applied before a further edit, that
edit must ship as a new forward migration instead.

**Same-organization foreign keys.** `companies`, `contacts`, `opportunities`,
`strategy_boards` and `strategy_columns` gained a `(id, organization_id)` key,
and every child key was rebuilt as a composite reference with the on-delete
behaviour it had before (cascade where a child cannot outlive its parent,
`set null (link_column)` on tasks). A contact in organization B cannot point
at a company in organization A, whatever the application does.

**Retired, not dropped.** `owner_id` stays on every table, unread and
unwritten. The RLS policies that named it are replaced by membership policies
through `public.is_org_member(uuid)`. Those policies are still dormant — reads
use the direct Postgres connection and writes the secret key, both of which
bypass RLS — but they now state the real rule for the day a publishable-key
path is opened.

**The rollout default.** `organization_id` is added as `not null default
<khyte>`. That is the backfill, and it also keeps the CRM up between the
migration landing and the new code deploying: an insert from the older code
still succeeds and lands in the only organization that exists. It must be
removed before a second organization is created — see *Deploy order*.

---

## Identity and sessions

```
login form ──▶ app/actions/auth.ts
                 │  verifyCredentials()      lib/auth/identity.ts  (Supabase Auth, publishable key)
                 │  listMembershipsForUser()  lib/org/members.ts
                 │  mintSession() + insert app_sessions
                 ▼
             khyte_session cookie  <token>.<expiry>.<hmac>
                 │
   proxy.ts ─────┤  readSessionCookie(): signature + expiry only, no I/O
                 │
   getAuthContext() ──▶ app_sessions ⋈ organization_members(active) ⋈ organizations
                        = AuthContext { userId, organizationId, organization, viewer }
```

- `proxy.ts` remains an optimistic gate. The real check is `getAuthContext()`
  (`lib/auth/context.ts`), memoized per request, joined to an *active*
  membership. Revoking a membership therefore ends access on the next request
  — pages, actions, routes, wallpaper links and queued MCP calls alike — and
  `revokeMember` also revokes that person's sessions and MCP connections in
  the organization.
- A cookie that is still signed but whose session is gone (revoked, or
  logged out elsewhere) is not a lockout: the login page is always served,
  the root layout sends such a request to it, and logging in again revokes
  the old session row. This is why `proxy.ts` no longer bounces a signed
  cookie away from `/login`.
- **Credential generation.** Every membership carries
  `credential_generation`. Wallpaper links, OAuth authorization codes and MCP
  connections record it when minted and are refused once it no longer
  matches. Revoking, re-adding and resetting a password each rotate it, so a
  credential copied before any of those cannot come back to life when the
  same membership row is active again. Sessions are plain rows and are
  simply revoked. Pending authorization codes are also deleted outright on
  revoke and reset.
- **Access already granted to a running request ends at the next write.**
  An MCP request is authenticated once, but every commit re-verifies the
  connection and its membership inside the write transaction, under the
  same account lock revocation takes, so a bulk import stops at the first row
  after the member or connection is revoked.
- **A browser tab is bound to the identity it was built for.** Every
  Server Action call carries the organization and user the tab believes it
  is acting as; the server refuses a write whose expectation does not match
  the session that arrived (`context_mismatch`), and the tab reloads. A
  snapshot for a different organization or viewer is refused the same way.
  Client-supplied ids are an expectation to verify, never an authority.
- Supabase Auth is contacted only to verify a password or to manage an
  account (`lib/auth/identity.ts`). The GoTrue session it returns is discarded
  and revoked server-side; the app's own session is the credential.
- A correct password with no active membership is not a login.
- A user with several memberships enters the one they joined first; the
  session records which organization it acts in, so switching is a later
  addition, not a redesign.
- Without a database there can be no sessions: the app boots on demo data but
  cannot be entered. Developer setup now needs a Supabase project.

**Display links** (`/goals/display/<colleague>?k=…`) carry
`<organizationId>.<memberId>.<hmac>`; the HMAC is over
`<organization>:<member>:<colleague>`, and the display routes accept a link
only while the membership that minted it is still active
(`lib/auth/display-access.ts`). Revoking a member therefore ends their
wallpaper links and nobody else's. Old links no longer verify and must be
copied again from `/goals`.

**MCP.** Consent binds the approving account and organization into the
authorization code; the token exchange copies them onto the connection; every
bearer authentication joins the active membership. The MCP principal is
`{ connectionId, scopes, userId, organizationId }` and is the actor for every
service call, receipt and event (`crm_events.recorded_by`).

---

## What is scoped, and where

| Path | Scope source | Files |
| --- | --- | --- |
| Root layout snapshot, live-sync polls | `getAuthContext()` | `app/layout.tsx`, `app/api/snapshot/*`, `lib/db/queries.ts` |
| Server Actions (CRM, goals, export) | `requireAuth()` via `run()` / `guardedOk()` | `app/actions/*.ts` |
| Goals editor, timeline, weekly cards | `requireSession()` / `getAuthContext()` | `app/goals/*`, `app/api/goals/*` |
| Wallpaper | display token, else session | `app/goals/display/[colleague]/*` |
| Activity log, board metrics, archive | organization passed explicitly | `lib/db/events.ts`, `lib/db/board-metrics.ts` |
| MCP tools, bulk import, export, receipts | `Principal` from bearer auth | `lib/crm/service.ts`, `lib/mcp/*` |
| OAuth consent and token exchange | `getAuthContext()` → code → connection | `app/oauth/*`, `lib/mcp/oauth.ts` |
| Member management | `requireOwner()` | `app/actions/members.ts`, `lib/org/members.ts` |

Updates and deletes filter by organization *and* verify a row was affected;
a cross-organization id reads as not found, never as success.

---

## Members

**Settings → Organisation** lists every member. Owners can add a member,
edit name / role / roster label, reset a password, and revoke. The last active
owner cannot be revoked or demoted. The app sends no email in this release.

**The account is global; the owner is not.** One Supabase Auth login serves
every organization a person belongs to, while an owner's authority stops at
their own roster. The rules that follow from that, enforced in
`app/actions/members.ts` and mirrored by the CLI:

- *Add* creates the account, or takes over one that is active nowhere else,
  always with a fresh temporary password shown once. Every refusal (already a
  member, roster label taken) is decided before an account is created, so a
  refused add leaves nothing behind. An account that is an active member of
  another organization is refused (`belongs_elsewhere`): joining a further
  organization waits for an invitation the person accepts themselves, a later
  stage.
- *Reset password* is refused for an account active elsewhere
  (`shared_account`), and otherwise ends every session and every MCP
  connection the old password was behind.
- *Revoke* ends the membership, the person's sessions and MCP connections in
  the organization, and their wallpaper links.

Without these rules an owner of one organization could have taken over a
shared account and logged in as that person into another organization.

**Under locks, in one transaction.** Two invariants cannot be kept by a
check followed by a write: an organization always has at least one active
owner, and an account is administered by one organization at a time. Every
roster write takes the organization's advisory lock and, when it touches an
account, that account's lock; the check and the change happen inside one
serialized step, and the acting owner is re-checked inside the lock as well.

**One lock order, everywhere.** Organization advisory lock, then account
advisory lock, then row locks. Row locks last is as important as the two
advisory locks: a writer holding a membership row for update while waiting
for the account lock would deadlock against the OAuth token exchange, which
holds the account lock while its connection insert needs that row. So every
writer that needs an account lock learns the account from a plain read,
takes the locks, and only then re-reads its rows for update and revalidates
every condition. The token exchange, the refresh grant, direct token
revocation (`/oauth/revoke`) and the tool commit all take the account lock
in that same order, so revocation and in-flight work have a defined order:
a commit that has already passed its check finishes first and the next one
is refused; a revocation that finished first makes the commit fail.

**Supabase Auth cannot be rolled back by SQL, and a commit's outcome can be
lost.** Add and reset write the membership first, call Supabase Auth second,
and revoke old credentials last, so a failed password call rolls the
membership back and nothing has changed. After a failure that follows the
external call, the flow asks the database instead of trusting the
exception: an active membership for that account means the claim committed
and the owner receives the result and the password after all; for a reset,
the generation the call chose is either on the row (committed) or not. Only
when the read says no is an unfinished state reported, and it says which:
`membership_unsaved` (the account exists; if the person now shows on the
roster use Reset password, otherwise add again) or `reset_unconfirmed` (run
Reset password once more). The flows live in `lib/org/administration.ts`
behind an injectable identity provider so the suite drives every one of
these paths with a fake account service.

**Member actions pass the same identity gate as CRM writes.** Every member
action carries the scope the Settings page believes it is acting in and is
refused with `context_mismatch` before any account lookup when it does not
match the session; the page marks the store finished and reloads rather
than filing anything the server returned.

**CLI**, for bootstrap and recovery:

```bash
npm run org:members -- list
npm run org:members -- add --email erik@example.com --name Erik --role member --colleague erik
npm run org:members -- add --email hai@example.com  --name Hai  --role owner  --colleague hai
npm run org:members -- reset-password --email erik@example.com
npm run org:members -- revoke --email erik@example.com
```

`add` prints a temporary password exactly once when none is supplied. It
refuses to run without `--email`; it never guesses which account belongs to
which roster label.

**Unresolved identity mappings.** The migration creates no accounts and no
memberships. Before the new code is deployed, Hai must create the accounts
and state the mapping explicitly:

| Roster label | Account | Status |
| --- | --- | --- |
| hai | hai@khyteteam.com (assumed from the session; confirm) | not created |
| erik | unknown | not created |
| abdi | unknown | not created |

Historical rows keep their roster labels regardless; the mapping only
decides who a logged-in person is *known as*.

---

## Deploy order

The migration and the code must not be separated by more than one deploy
window, in this order:

1. `npm run db:status`, then `npm run db:push` — applies
   `20260920120000_organizations.sql`. The old code keeps working through
   the rollout default, and the old weekly-archive index is kept beside the
   new one so the deployed archive still finds its conflict target. Two
   things do stop at this point, so do steps 1 to 4 in one sitting: the
   ChatGPT connection is revoked here, not at step 4, and a reconnect made
   before the new code is live is refused by it afterwards (no account behind
   it) and must be redone.
2. `npm run org:members -- add …` for each team member (at least one owner).
   Needs `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and
   `SUPABASE_DB_URL` in `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` on the deployment. Keep
   `AUTH_SECRET`; rotating it logs everyone out, as before. Leave
   `AUTH_PASSWORD` in place for now: the new code ignores it, but the old
   build still needs it, and the old build is the rollback target until
   step 5. Remove it together with step 5.
4. Deploy. Log in with an account. Reconnect ChatGPT (the old connection is
   revoked). Copy new wallpaper links from `/goals`.
5. After the deployed build is verified, move
   `supabase/followups/20260927120000_drop_organization_rollout.sql` into
   `supabase/migrations/` (same timestamp or a newer one) and push it, then
   remove `AUTH_PASSWORD` from the deployment. It drops the `organization_id`
   defaults, the old weekly index and the rollout guard. It is deliberately
   outside `migrations/` until then: the default is what makes step 1 safe
   to run ahead of step 4. Until it has run, the database refuses to create
   a second organization (`organizations_rollout_guard`), so the ordering is
   enforced rather than remembered. The test suites are written for both
   layouts: they apply the migrations up to the cleanup file, assert the
   guard, then apply the cleanup from wherever it lives, so promoting the
   file needs no test change.

**Rollback, before step 5.** The old build is a valid rollback target
between step 4 and step 5, and only then: the column defaults let it insert
without an organization, the old weekly index lets its archive find its
conflict target, and `AUTH_PASSWORD` (still set) lets it authenticate.
Rolling the migration itself back is not supported; it is additive, and
`owner_id` was never populated, so there is nothing the old code would miss.
Sessions, memberships and MCP identity would sit unused until the new build
returns. Rehearse this on disposable data before relying on it: log in with
the shared password, create a prospect, and let a week archive.

**After step 5, forward only.** Once the defaults and the old index are
gone the old build's inserts and archive fail, and once a second organization
exists the old build's unscoped queries would show every organization's data
to everyone. From that point recovery means fixing forward on the new code,
never redeploying the legacy build.

---

## Exit evidence (verified 2026-09-20 on this branch)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Production build | `npm run build` | passes |
| Service, OAuth, MCP, sessions, members, isolation, wallpaper links, credential generation, revocation mid-request, account claims, recovery, token revocation | `npm run test:mcp` | 42 / 42, none skipped |
| Migration rehearsal, rollout guard and follow-up (both layouts) | `npm run test:org` | 7 / 7 |
| Structural scoping lint over actions and data modules | `npm run test:scoping` | 3 / 3 |
| Client identity boundary (store refuses a foreign snapshot) | `npm run test:store` | 2 / 2 |
| HTTP boundaries against the built server | `npm run test:mcp:http` | 3 / 3 |
| Real multi-connection concurrency (opt-in, needs `MCP_TEST_DATABASE_URL`) | `tests/mcp-postgres.test.ts` | written, not run here |

**Review history.** An adversarial review on the first cut confirmed three
gaps (shared-account takeover via add plus reset; wallpaper links outliving
revocation; a signed-but-dead cookie locking a person out of the gate) and
five smaller ones, all fixed. Astra's audit of commit `977e05c` then found
seven more, all addressed in the correction pass and covered by the tests
named after its acceptance criteria: credentials reviving after a re-add
(credential generation), writes continuing after revocation inside an
authenticated request (per-commit revalidation under the account lock),
client snapshots merging across identities (identity boundary and scope
binding), unserialized account claims (locked claim protocol with an
explicit recovery path), concurrent owner changes reaching zero owners
(organization lock), the cleanup promotion breaking the test setup
(layout-independent migration helper), and the rollback runbook.

Astra's review of `4bb1f69` kept that work and asked for four more
corrections, all in this branch: member actions now pass the same scope
gate as CRM writes and Settings reloads on a mismatch instead of filing the
result; the lock order is uniform (organization, account, then rows) with
plain reads before locks and revalidation after, which removes the
exchange-versus-revoke deadlock; direct token revocation takes the account
lock so it orders against in-flight commits; and recovery after an external
side effect reads the database back instead of inferring from the
exception, covering both the created-account case and the lost
acknowledgement. The client identity test now runs under its own command
instead of skipping.

What the suites establish:

- **Organization isolation** (`tests/mcp.test.ts`, "organizations are
  invisible to each other…"): a prospect, lead and task committed in Khyte
  are not found by the other organization through `getRecord`,
  `searchRecords`, `exportProspects`, `getBulkResult`, `get_operation_result`
  or the MCP server; writes against Khyte's ids fail `not_found`; replaying
  Khyte's request id from the other organization is `request_id_conflict`;
  duplicate matching is per organization.
- **Revocation**: `revokeMember` makes `authenticateBearer` refuse the
  person's connection, the refresh grant fail, and `resolveAuthContext`
  return null, while their session in another organization survives.
- **Sessions**: a minted cookie resolves to its viewer and organization;
  tampered, expired, revoked or DB-expired sessions resolve to null.
- **Members**: one membership per account (reactivated, never duplicated),
  one active member per roster label, never zero active owners,
  cross-organization member ids read as not found.
- **MCP identity**: codes and connections carry the approving user and
  organization; a code with no person or no active membership is refused.
- **Wallpaper links**: a token opens one colleague's board in one
  organization and resolves only while the membership that minted it is
  active; revoking that member kills their links and nobody else's.
- **Account guards**: an account active in another organization reads as
  "elsewhere" to any other owner (what add and reset consult); replacing a
  password ends every session of that account; revoking connections is
  per organization.
- **Rollout guard**: a second organization is refused while the
  `organization_id` defaults stand, and allowed once the follow-up has
  dropped them, the old weekly index and the guard itself.
- **Migration rehearsal** (`tests/organization-migration.test.ts`): legacy
  rows in every table backfill to Khyte with counts unchanged; the
  shared-password connection is revoked while its receipts and interactions
  stay; cross-organization links are rejected by the composite keys; a
  rolled-back attempt leaves nothing behind and the real apply then succeeds.
- **Existing workflows**: the pre-existing 22 MCP tests pass unchanged in
  substance; the HTTP suite shows unauthenticated and unknown-cookie requests
  going to the login page and protocol routes behaving as before.

**Automated checks versus rehearsal.** The PGlite suites run on a
single-connection engine: they prove the service, OAuth, membership,
recovery and migration rules sequentially, and they cover the browser write
path only structurally (`tests/scoping.test.ts` lints every PostgREST chain
and SQL statement in the actions and data modules for an organization
predicate; it is a lint, not proof). The client identity boundary runs under
`npm run test:store`, with a test-only preload that blanks the framework's
`server-only` marker; it proves the store's refusal, not the browser reload.
Not exercised here: a real browser session against a live Supabase Auth
project, the Server Actions end to end (the member gate is covered through
`scopeMatches` and the flows, not through a cookie), the display routes over
HTTP with a live database, and genuine multi-connection concurrency. The
lock protocol is verified by reading and by the opt-in
`tests/mcp-postgres.test.ts`, which holds the owner-versus-owner,
claim-versus-claim, exchange-versus-revoke and commit-versus-token-revoke
scenarios with explicit barriers on two connections. It needs a real
PostgreSQL (`MCP_TEST_DATABASE_URL`) and could not be run on this machine:
the local PostgreSQL 18 install has no server libraries and there is no
Docker. Run it against a disposable instance before accepting Stage 1.

Unresolved identity mappings: the table under *Members*.

---

## Known limits of this stage

- The roster is still the fixed enum. A second organization can have members
  but cannot attribute work to anyone but erik / abdi / hai until the
  per-organization roster lands.
- No workspace switcher for a user in several organizations; login enters
  the organization joined first.
- No invitation flow. An account that is active in another organization
  cannot be added; the refusal itself tells an owner that such an account
  exists, which is the same class of disclosure as any sign-up form's
  "email already taken". Closing it fully needs the consent-based invitation
  a later stage adds.
- No password-recovery email; owners reset passwords, and only for accounts
  whose sole active home is their organization.
- RLS is correct but dormant; every privileged path is scoped in code and
  covered by tests instead.
- `supabase/seed.sql` predates the strategy-board migration and does not
  apply; it was already broken before this stage and is untouched.
