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
3. Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` on the deployment. Remove
   `AUTH_PASSWORD` (unused). Keep `AUTH_SECRET`; rotating it logs everyone
   out, as before.
4. Deploy. Log in with an account. Reconnect ChatGPT (the old connection is
   revoked). Copy new wallpaper links from `/goals`.
5. After the deployed build is verified, move
   `supabase/followups/20260927120000_drop_organization_rollout.sql` into
   `supabase/migrations/` and push it. It drops the `organization_id`
   defaults, the old weekly index and the rollout guard. It is deliberately
   outside `migrations/` until then: the default is what makes step 1 safe
   to run ahead of step 4. Until it has run, the database refuses to create
   a second organization (`organizations_rollout_guard`), so the ordering is
   enforced rather than remembered.

**Rollback.** Rolling the code back after step 4 keeps working because of
the default. Rolling the migration back is not supported; it is additive, and
`owner_id` was never populated, so there is nothing the old code would miss.
Sessions and memberships would simply sit unused.

---

## Exit evidence (verified 2026-09-20 on this branch)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Production build | `npm run build` | passes |
| Service, OAuth, MCP, sessions, members, isolation, wallpaper links | `npm run test:mcp` | 31 / 31 |
| Migration rehearsal, rollout guard and follow-up | `npm run test:org` | 7 / 7 |
| HTTP boundaries against the built server | `npm run test:mcp:http` | 3 / 3 |

An adversarial review (four lenses, every finding verified twice) ran on the
first cut and confirmed three real gaps, all closed and covered above: an
owner could take over a shared account through add-member plus password
reset; wallpaper links outlived membership revocation; a revoked person with
a still-signed cookie was locked out of the login page. Smaller confirmed
items (a global login throttle any client could trip, a 429 from Supabase
Auth reading as a wrong password, the roster losing a just-added member to a
stale poll, an orphaned account on a refused add, the deploy-window index
mismatch) are fixed as well.

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

Not exercised here: a browser session against a live Supabase Auth project
(no accounts exist yet), and the production migration push. Both are part of
the deploy steps above.

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
