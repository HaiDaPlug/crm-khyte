# Database — Khyte CRM

**Stack:** Supabase (hosted Postgres)
**State:** schema and data layer wired; no auth yet, single operator

The app runs with or without a database. Without credentials it serves the
in-memory demo data from `lib/mock-data/` and logs a warning at boot — the UI
works, nothing persists. Point it at a Supabase project and the same UI is
backed by real rows.

---

## Setup

### 1. Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a
   new project.
2. Pick a region close to you and save the database password somewhere safe —
   the app does not need it, but you will want it later for direct psql access.
3. Wait for provisioning to finish (a minute or two).

### 2. Run the schema

Migrations are applied with the Supabase CLI, which ships as a devDependency —
no global install:

```bash
npm run db:status    # dry run: what would be applied
npm run db:push      # apply pending migrations

npm run db:push -- --include-seed    # also load supabase/seed.sql
```

`db:push` needs `SUPABASE_DB_URL` in `.env.local` (step 3 below). The seed is
optional and safe to run twice — every insert is `on conflict (id) do nothing`.
Skip it to start with an empty CRM.

You can also paste `supabase/migrations/20260819120000_init.sql` straight into
the dashboard's **SQL Editor** if you would rather not deal with the connection
string. The CLI is worth it once there is a second migration, because it tracks
what has already been applied in `supabase_migrations.schema_migrations`.

**Migration files must be named `<14-digit-timestamp>_<name>.sql`** — that is
how the CLI orders them and matches them against the remote history. Generate
new ones with `npx supabase migration new <name>` rather than by hand.

### 3. Add credentials

1. Copy the template: `cp .env.example .env.local`
2. In the dashboard, go to **Settings → API Keys → "Publishable and secret API
   keys"** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Secret key** (`sb_secret_…`) → `SUPABASE_SECRET_KEY`
3. Restart the dev server. The "no Supabase credentials" warning should be gone.

`.env.example` also carries `AUTH_PASSWORD` and `AUTH_SECRET` for the password
gate. Those are **not** optional the way the Supabase values are — the app runs
on demo data without a database, but it throws without those two rather than
serving an open gate. Generate a secret with the one-liner in `.env.example`.

This project uses the **new API keys**, not the legacy JWT `anon` /
`service_role` pair on the "Legacy API Keys" tab. The mapping is
`anon` → publishable (`sb_publishable_…`), `service_role` → secret
(`sb_secret_…`); legacy keys are deprecated and stop working at the end of
2026. If you paste a legacy key in by mistake the app still runs and logs a
warning telling you to swap it.

Two properties of secret keys are worth knowing, because they shape the code:

- They are **not JWTs**. `@supabase/supabase-js` v2.112+ recognises the
  `sb_secret_` prefix and handles the header difference itself, so
  `createClient(url, key)` needs no special casing.
- Supabase **rejects them from browser User-Agents** with a 401, which is a
  useful backstop underneath the `server-only` import in
  `lib/supabase/server.ts`.

Create a lead, refresh the page — it is still there.

---

## The app is linked to a project, not an account

Worth being explicit about, especially if you have more than one Supabase
account. Every link is a value in `.env.local`, and all three are project-scoped:

- **Project URL** — its subdomain is the *project ref*, which is the only
  identifier of which database this app talks to.
- **Secret key** — issued by that project, revocable from that project. It
  carries no account identity.
- **`SUPABASE_DB_URL`** — a Postgres connection string with the database
  password. Also project-scoped: it authenticates to one database, not to a
  Supabase account.

Nothing in this repo or on the dev machine holds an account credential. `~/.supabase`
has no `access-token` because `supabase login` has never run.

`supabase/config.toml` exists — `supabase init` created it — but it is **not** a
link. It is local CLI configuration, and its `project_id = "crm-khyte"` is just
a name for the local stack, unrelated to your project ref. The account link
would live in `supabase/.temp/`, written by `supabase link`; that directory
holds only a CLI version cache, and is gitignored either way.

This is why `npm run db:push` passes `--db-url` instead of using a linked
project: `supabase db push --linked` requires `supabase login`, and that token
is account-wide. The app never authenticates *as you*; it authenticates as one
project's credentials.

On startup the server logs which project it reached:

```
[khyte] Supabase project: <project-ref>
```

**Check the ref, not the account.** When you open the dashboard, the project ref
is in the address bar (`/dashboard/project/<ref>`). Matching that against the
log line is the reliable check — which account a browser session happens to be
logged into tells you nothing about which database the app is writing to.

Three things would introduce an account-level link. Avoid them unless you mean
it:

| Action | What it ties to your account |
|---|---|
| `supabase login` / `supabase link` | Writes an account-wide access token to `~/.supabase`, ambiguous across two accounts |
| Vercel ↔ Supabase integration | OAuth at the account level; paste env vars into the deployment manually instead |
| Management API / personal access tokens | Account-scoped, can reach every project you own |

Most CLI commands accept `--db-url`, which avoids all of this.

### Linking the CLI without `supabase login`

If you want the normal linked workflow (`supabase db push` with no `--db-url`),
you can have it without the account ambiguity. `supabase link` authenticates
with `~/.supabase/access-token`, which is machine-global — that is what drags
the CLI to the wrong account. `SUPABASE_ACCESS_TOKEN` **overrides that file**,
so putting the token in `.env.local` scopes the account to this project.

1. Sign into the account that owns this project and create a token at
   [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
2. Put it in `.env.local` as `SUPABASE_ACCESS_TOKEN=sbp_…`
3. Link, then push:

```bash
npm run db:link -- --project-ref wmnobqhypkocirfybqsj
npm run db:push
```

Use `npm run supabase -- <anything>` for other CLI commands — it injects the
token the same way:

```bash
npm run supabase -- projects list
npm run supabase -- migration list
```

Never run bare `npx supabase link` or `supabase login`. Those read the global
token and will reach for your other account. The wrapper exists precisely so
you do not have to remember which account the machine last logged into.

`db:push` detects linking automatically: linked → `--linked`, otherwise it
falls back to `SUPABASE_DB_URL`. Both are project-scoped either way.

**A personal access token is a full account credential** — it can reach every
project that account owns, unlike the secret key which is scoped to one project.
`.env.local` is gitignored, but that is the reason `SUPABASE_DB_URL` alone is
the lighter-weight option if you do not need `link`.

---

## How the pieces fit

```
app/layout.tsx           server component; one loadSnapshot() per page load
  └─ lib/db/queries.ts   reads the eight CRM tables, maps rows → domain types
       └─ lib/supabase/server.ts   secret-key client, server-only

lib/store/provider.tsx   builds one store per request, holding the snapshot
  └─ lib/store/store.ts   client source of truth for the session
       └─ app/actions/crm.ts   'use server' writes, one per mutation
```

**The direction board is a second, deliberately separate read path.** `/goals`
and `/goals/display/[colleague]` call `loadGoals()`, which reads only `goals`,
`goal_metrics` and `focus_items` — it is not a key on `CRMSnapshot` and those
rows never enter the CRM store:

```
app/goals/…              server components; one loadGoals() per page load
  └─ lib/db/queries.ts   reads the three goals tables
       └─ app/actions/goals.ts   'use server' writes, one per mutation
```

The split is load-bearing rather than tidiness. The wallpaper route reloads
itself every five minutes; folding goals into `loadSnapshot()` would drag every
company, contact, opportunity, lead, note and strategy card through Postgres on
each of those refreshes, forever, to render three small tables. `app/layout.tsx`
skips `loadSnapshot()` entirely on display routes for the same reason.

The store is constructed **with** the snapshot rather than filled after the
fact. `useSyncExternalStore` renders both the SSR pass and the client's
hydration pass from `getInitialState()`, which Zustand fixes at construction, so
a store populated afterwards renders empty through hydration. One store per
provider mount also means one per server request, which is what keeps concurrent
requests from sharing a working set once auth lands.

**Reads** happen once per full page load, in the root layout. Layouts do not
re-run on client-side navigation, so moving between `/leads` and `/pipeline`
costs nothing — the store already has the data. `loadSnapshot()` calls
`connection()` to opt out of prerendering; without it Next would bake the CRM
into static HTML at build time.

**Writes** are optimistic. Store actions update local state immediately and
then fire the matching Server Action. Nothing waits on the network, so drag and
drop stays instant.

**Names** differ by layer on purpose. Postgres columns are snake_case, and two
of them are renamed to dodge reserved words — `strategy_cards.column_id` and
`strategy_cards.sort_order` map back to `columnId` and `order`. All of that
translation lives in `lib/db/mappers.ts`; nothing outside `lib/db` sees a row.

**IDs** are generated on the client with `crypto.randomUUID()` and sent to the
database, rather than being assigned by Postgres. That is what lets the
optimistic record and the stored record be the same record without a round-trip
to learn the id.

---

## Auth and RLS

Every table has an `owner_id` column and RLS is **enabled**, with policies that
scope rows to `auth.uid() = owner_id`. Right now those policies match nothing:
the server uses a secret key, which holds BYPASSRLS and skips them entirely. The
structure is there so that adding auth is a wiring job, not a migration.

When auth lands:

1. Swap `lib/supabase/server.ts` for a request-scoped client built from the
   user's session (this is where `@supabase/ssr` and the publishable key come in).
2. Set `owner_id` on insert in `app/actions/crm.ts`.
3. Claim the existing rows:
   `update companies set owner_id = '<your-user-uuid>' where owner_id is null;`
   and the same for the other ten tables (the three goals tables included —
   they carry `owner_id` and RLS policies on the same pattern, even though the
   direction board is company-wide rather than per-person, so that the eventual
   multi-tenant story does not need a second migration).
4. ~~Move the Zustand store behind a per-request React context.~~ Done
   2026-08-21 — `lib/store/provider.tsx` builds one store per request. It was a
   module singleton shared across concurrent server requests, which was harmless
   for one operator but wrong the moment there are two users. Fixed early because
   the same change fixed a hydration bug; see Known issues in
   `docs/current_state.md`.

---

## Known gaps

- ~~**The Server Actions are unauthenticated.**~~ Fixed by the shared-password
  gate: every action in `app/actions/crm.ts` and `app/actions/goals.ts` runs
  `requireAuth()` through one of two helpers, so a direct POST without a
  session is rejected. They authenticate but still do not **authorize** —
  there is one password and no per-user identity, so there is no `owner_id` to
  check a caller against. That half lands with accounts.
- **The wallpaper display token is a weaker credential than a session.** Anyone
  holding a `/goals/display/<name>?k=…` link reads that board — goals, targets,
  revenue — with no password. It is bound to one colleague, confined to display
  routes, read-only, and never expires. Treat the URL as a secret; rotate
  `DISPLAY_SECRET` to invalidate every link. See `lib/auth/display-token.ts`.
- **Failed writes are quiet.** A write that fails sets `syncError` in the store
  and logs to the console, but nothing renders it yet — the optimistic change
  stays on screen. Wiring `syncError` to a toast is the natural next step.
- **No realtime.** Two open tabs will not see each other's changes until reload.
  Supabase realtime subscriptions would close this.
- **No edit or delete.** The data layer covers create and update because that is
  what the UI does today. Delete has no button, so it has no action.
- **Validation is the database's job.** The enums, foreign keys and not-null
  constraints in the schema are what reject bad writes; there is no schema
  validation layer in front of them.
