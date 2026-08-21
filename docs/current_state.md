# Khyte CRM — Current State

**Date:** 2026-08-21
**Phase:** MVP + persistence (Supabase live, no auth yet)

The database is provisioned and running. Project ref `wmnobqhypkocirfybqsj`
(eu-north-1); schema and seed applied; reads and writes verified end to end
against the live API.

---

## What exists

### Stack
- Next.js 16.2.1 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Supabase (`@supabase/supabase-js`) — hosted Postgres; schema in `supabase/migrations/`, setup in `docs/database.md`
- Supabase CLI 2.115 (devDependency) — migrations via `npm run db:push`. Auth is sourced from `.env.local`, never `~/.supabase`, so the CLI cannot drift to a second Supabase account
- Zustand — global state management (one store per request, built with the database snapshot; writes through Server Actions)
- @dnd-kit/core + sortable + utilities — drag/drop
- @tanstack/react-table 8 — table shell
- lucide-react — icons
- Radix UI primitives (dialog, dropdown, separator, slot, tooltip)
- motion (framer-motion successor) — installed, not yet used in components
- clsx + tailwind-merge + class-variance-authority — style utilities

### Routes
| Route | Status | Notes |
|---|---|---|
| `/` | Done | Redirects to `/dashboard` |
| `/dashboard` | Functional | Command-center home, fits the viewport with no scrolling. Left: Pipeline (total value) and This Week (open task count) stacked as grainy burnt-orange cards, vertically centered. Right: card-less assistant chat column — time-aware greeting ("Good morning/afternoon/evening / It's late-night, Hai.", no icon, thin Source Serif 4 headline, trailing period), solid rounded composer with a hairline separator between the textarea and the keybind-hint/mic/send row (Enter to send, autosize, mic dictation via Web Speech API), icon quick-prompt pills, mock assistant replies keyed off lead names. |
| `/leads` | Functional | TanStack Table + sorting + filter bar (wired) + board view (grouped by stage) + detail drawer. Search filters data via Zustand. "New Lead" capture modal (top right) with company/contact autofill comboboxes; selecting a pipeline stage is what adds the lead to the board (no stage = off board). Table shows "On board" pipeline indicator. |
| `/pipeline` | Functional | dnd-kit kanban, 9 stages, drag between columns syncs to Zustand store. Active pipeline total value in header. Drop target feedback. Only shows leads with `inPipeline: true`; "Add Leads" popover (top right) lists off-board leads and adds them at stage "New". |
| `/strategy` | Functional | Opportunity selector dropdown + 6-column strategy board with inline add-card forms. Cards sync to Zustand. |
| `/companies` | Functional | Card grid with deal count, contact count, total value. Search/filter input. Click-to-open detail drawer with company info, contacts, opportunities. "New Company" essentials modal (top right). |
| `/contacts` | Functional | List view with search/filter. Click-to-open drawer with contact info, email/LinkedIn links, company card, related opportunities. "New Contact" essentials modal (top right) with company autofill combobox. |
| `/tasks` | Functional | Grouped checklist (Overdue/Today/Upcoming/Completed). Checkbox toggle. Inline add-task form with priority selection. 8 realistic mock tasks. |
| `/settings` | Functional | Display preferences: theme (dark/light), interface language (Swedish/English), regional format, currency, date format, compact numbers, reset-to-defaults, plus a live preview row showing a sample amount and date under the current settings. Swedish UI and `sv-SE` formatting are the fresh-session defaults. Persisted to `localStorage`, applied app-wide. |

### Components
```
components/
  layout/
    AppShell.tsx       — client wrapper; mounts `CRMStoreProvider` with the server snapshot, then `AppShellChrome` (which reads the store, so it has to sit inside the provider) applies data-theme to <html> and reads localStorage on mount
    AppSidebar.tsx     — 232px → 64px collapsible sidebar; grain-nav burnt-orange treatment with film grain; amber-tinted internal dividers; Sun/Moon theme toggle above collapse button; forced `data-theme="dark"` on the `<aside>` so the rail always renders dark regardless of the page's active theme. Header shows the brand lockup (`public/khyte-logo-text-png.png` via `next/image`) — one asset for both states: an `overflow-hidden` box animates 84px → 32px on collapse, clipping the lockup down to just the orange K mark. Nav labels 15px, utility buttons 14px
    Topbar.tsx         — 52px sticky top bar, functional search (reads/writes Zustand searchQuery)
  crm/
    CaptureBox.tsx     — textarea input, Cmd+Enter submit, simulated AI extraction (800ms delay) — orphaned since /inbox was removed
    SuggestionPreviewCard.tsx — AI extraction card with Apply (updates matching opportunity) / Dismiss — orphaned since /inbox was removed
    CRMTable.tsx       — sortable TanStack table, priority dots, stage badges, dark theme
    PipelineBoard.tsx  — dnd-kit kanban board, drag overlay, drop target feedback, stage dot indicators
    LeadCard.tsx       — kanban card: company, contact, priority, deal value, amber hover glow
    StrategyBoard.tsx  — 6-column dnd-kit board with sortable text cards, inline add forms
    DetailDrawer.tsx   — portaled slide-in drawer (translate-x animation), company/contact/deal/notes. Shares the modal's material (`grain-modal grain-drawer`), type scale and `data-theme="dark"`; `role="dialog"` + focus trap via `useDialogBehavior`; `inert` while closed. Retains the last row it rendered so the panel slides out with its content instead of emptying first. **Notes are editable in place** — click the note or "Edit"/"Add note", ⌘↵ saves, Esc cancels; writes through `updateOpportunity`. Dirty-checked: dismissing with unsaved text raises `ConfirmDialog` on all four exit paths (Esc, Cancel, backdrop, X), and confirming from a *drawer-closing* path also closes the drawer while confirming from Cancel does not
    NotesTimeline.tsx  — chronological notes with AI-extracted indicator
    FilterBar.tsx      — stage + priority filters, active pills, animated panel toggle
    ViewToggle.tsx     — table/board view toggle
    EmptyState.tsx     — centered empty state with icon + message
    Modal.tsx          — centered modal shell, **portaled to `document.body` and unmounted when closed** (previously always-mounted inside the page tree, where an ancestor `transform`/`overflow` could clip it and the hidden subtree stayed in the a11y tree); dialog behaviour shared with the drawer via `useDialogBehavior` (grain-modal treatment, overlay, Esc, ⌘↵ submit shortcut, footer slot); `role="dialog"` + `aria-modal` + labelled by its title; accepts `suspended` so a stacked `ConfirmDialog` can take the keyboard; designed to fit without scrolling; panel forces `data-theme="dark"` so all capture modals render dark regardless of the page's active theme, matching the sidebar
    ConfirmDialog.tsx  — `role="alertdialog"` confirmation for unrecoverable actions, stacked above the dialog that raised it (which stands down via `suspended`). Replaces `window.confirm`, which renders in browser chrome and blocks the main thread. Focus opens on the safe choice
    FormFields.tsx     — shared form primitives: inputClass, Field, Combobox, ColorSlider. `Combobox` is `memo`-wrapped with full keyboard support (↑/↓ wrap, Home/End, Enter select, Esc dismiss), `role="combobox"`/`listbox` + `aria-activedescendant`, and closes on outside-pointerdown rather than blur so the list can be drag-scrolled. `ColorSlider` is a generic discrete slider that reads by colour and position instead of text — drag (pointer capture), click-anywhere, arrows/Home/End
    AddLeadModal.tsx   — full lead capture: company/contact comboboxes with two-way autofill, stage pill row (picking a stage = joins the pipeline; default off board), priority (ColorSlider)/deal/next step/follow-up/tags/notes. Validates deal value and email inline and blocks submit on either; unsaved-changes confirmation on dismiss
    AddContactModal.tsx — contact essentials: name, role, company (combobox, creates if new), email, phone, LinkedIn
    AddCompanyModal.tsx — company essentials: name, domain, industry, size, location, tags
```

### Shared Config (lib/stage-config.ts)
- `STAGES: Stage[]` — canonical ordered list of the 9 pipeline stages
- `stageColors: Record<Stage, string>` — Tailwind badge classes for all 9 pipeline stages
- `priorityDot: Record<Priority, string>` — fixed hex colors (not Tailwind theme classes) for all 4 priority levels: critical `#E05252`, high `#E09040`, medium `#D4943C`, low `#4CAF72`. Deliberately not theme tokens — `bg-accent`/`bg-muted` shift hue between light/dark by design, but a priority indicator needs to read as the same color regardless of theme. Consumers apply it via inline `style={{ background: priorityDot[p] }}`, not className
- `priorityRamp: Record<Priority, { from: string; to: string }>` — two-stop gradients for the priority `ColorSlider`. Kept **separate** from `priorityDot` rather than replacing it: a 6px dot reads best flat and saturated, while a large fill needs a gradient. `priorityDot` still has eight consumers
- Single source of truth; imported by `CRMTable`, `leads/page`, `pipeline/page`, `AddLeadModal` (stage pills), `FilterBar`, `LeadCard`, and `dashboard/page` — previously `FilterBar`, `LeadCard`, and the dashboard each had their own duplicate (and inconsistent) local copy; consolidated into this one

### Display Settings and localization (`lib/settings.ts` + `lib/i18n/` + hooks)

Read-time formatting only — **never** what is stored. Amounts stay plain numbers
and dates stay ISO strings in Postgres; switching currency *relabels* 48000 as
`SEK 48,000`, it does not convert. There is no FX rate anywhere in the app.

| File | Role |
|---|---|
| `lib/settings.ts` | `DEFAULT_SETTINGS`, the `CURRENCIES` / `LOCALES` / `DATE_FORMATS` catalogs, and the formatters: `formatCurrency`, `formatDate`, `formatDateTime`, `formatNumber`, `currencySymbol` |
| `lib/hooks/useFormat.ts` | `useFormat()` — the formatters bound to the current settings. Every amount and date on screen goes through this |
| `lib/i18n/translations.ts` | Shape-checked Swedish and English dictionaries, including app-owned copy plus presentation labels for stages, priorities and strategy columns |
| `lib/hooks/useTranslations.ts` | `useTranslations()` — returns the active interface language and dictionary from the settings store |

- Currencies: **SEK, EUR, USD, GBP** (deliberately trimmed from a longer list)
- Interface languages: **Swedish** (default) and **English**. Interface language
  is independent of the eight regional formats spanning en/de/fr/es/nl/sv/ja
- Swedish is also the default regional format (`sv-SE`). Existing currency
  choices are preserved when pre-localization settings migrate; currency remains
  a separate user choice and values are never converted
- Database stages, priorities and strategy columns keep their canonical English
  enum values. Only their display labels are localized, so filtering, drag/drop
  and persistence contracts do not change
- `currencySymbol()` reads the symbol out of `Intl.formatToParts` rather than the
  `CURRENCIES` table, because the right symbol depends on locale *and* currency —
  SEK is `kr` under sv-SE but `SEK` under en-US. A hardcoded table would let an
  input prefix disagree with the formatted value beside it
- Every `Intl` call is wrapped: an unsupported locale/currency pair falls back to
  the raw number rather than throwing, so a bad preference can't blank a deal value
- `AddLeadModal`'s deal-value prefix is text, not a `DollarSign` icon, and the
  input's left padding comes from a length lookup (`pl-7`/`pl-9`/`pl-12`) — Tailwind
  needs whole class names at build time, so it can't be interpolated

**There are now zero raw `toLocaleString()` calls and zero hardcoded `$` in the
app.** Three `DollarSign` icons were removed along the way; left in place they
would have printed `$` next to `517 000 kr`.

### Error handling (lib/db/retry.ts + app/global-error.tsx)

Two layers, because the database read happens in the root layout and a failure
there has nothing above it to catch it:

| Layer | Handles |
|---|---|
| `lib/db/retry.ts` | Transient faults, absorbed silently. 3 attempts, 200ms/400ms backoff |
| `app/global-error.tsx` | Everything the retry can't — renders a themed screen with a working retry button |

**`global-error.tsx` is the only boundary in the app.** A segment `error.tsx`
does not wrap the layout above it, and `loadSnapshot()` runs in
`app/layout.tsx` — so this file is what stands between a failed read and a blank
page. It *replaces* the root layout when active: no `next/font`, no `AppShell`,
no store, so it declares its own `<html>`/`<body>` and imports `globals.css`
itself. Keep its dependency list short; it has to work when the rest did not.

- Pinned to `data-theme="dark"`. The theme preference lives in localStorage and
  the store, neither reachable here, and reading localStorage during render
  would desync server and client markup. Same call the sidebar and modals make
- `unstable_retry()` re-runs the failed render — a real retry, not a reload.
  Typed optional with a `window.location.reload()` fallback, because an
  `unstable_` prop can be renamed between Next releases and this page in
  particular must not break on an upgrade
- **`curl` will not show this page.** Error boundaries are Client Components, so
  a root-layout throw during SSR streams Next's bare `__next_error__` shell and
  this renders after hydration. Verify it in a browser; with JS off you get
  Next's default 500

Verified 2026-08-21 by booting with a deliberately invalid `SUPABASE_SECRET_KEY`
as an env override (`.env.local` untouched): the page rendered with its digest,
and "Try again" re-ran the render. That also exercised the retry's fast path —
`Invalid API key` is non-transient, so it failed on the first attempt rather than
spending 600ms on three.

### Dialog behaviour (lib/hooks/useDialog.ts)

`useDialogBehavior({ open, onClose, panelRef, shouldIgnoreEscape?, suspended? })`
— Escape to close, Tab trapped inside the panel, focus restored to whatever
opened it, and a page-scroll lock that compensates for the vanishing scrollbar so
the page behind doesn't shift. `useMounted()` gates the portal.

Extracted from `Modal` so the drawer could reuse it. **The scroll lock counter is
module-level and must stay shared** — before this, the drawer set
`document.body.style.overflow` directly, so it had no scrollbar compensation and
its lock fought the modal's.

**The keydown listener runs on `document` in capture phase, so nothing inside the
panel can pre-empt it with `stopPropagation` — a nested surface has to be handed
the key deliberately.** Hence two opt-outs, both callbacks read through refs so
the listener stays stable:

| Option | For |
|---|---|
| `shouldIgnoreEscape()` | An inline editor inside the panel that owns Esc as *cancel* (the drawer's note editor). Returning true skips the close entirely |
| `suspended()` | A dialog stacked *above* this one (`ConfirmDialog`). The outer dialog registers first, so without standing down its Esc would close the whole panel out from under the confirmation and its Tab trap would yank focus back down |

### Data Layer
Full detail in `docs/database.md`. Shape of it:

| File | Role |
|---|---|
| `supabase/migrations/20260819120000_init.sql` | 6 tables, 3 enums, indexes, `updated_at` triggers, RLS enabled with owner-scoped policies |
| `supabase/seed.sql` | the former mock data as real rows, fixed UUIDs, re-runnable |
| `supabase/config.toml` | local CLI config from `supabase init`; not a project link |
| `scripts/supabase.mjs` | `npm run supabase -- <cmd>` — runs any CLI command with `SUPABASE_ACCESS_TOKEN` taken from `.env.local`, which overrides the machine-global `~/.supabase/access-token` |
| `scripts/db-push.mjs` | `npm run db:push` — pushes to the linked project if `supabase/.temp/project-ref` exists, else falls back to `SUPABASE_DB_URL`. Validates the connection string and echoes the target host before writing |
| `lib/supabase/server.ts` | secret-key (`sb_secret_…`) client, `server-only` guarded; `isSupabaseConfigured` flag, legacy-key warning |
| `lib/db/rows.ts` | snake_case row types mirroring the schema |
| `lib/db/mappers.ts` | row ↔ domain translation both directions (`column_name`→`column`, `sort_order`→`order`, null→`''`) |
| `lib/db/queries.ts` | `loadSnapshot()` — reads all six tables in one pass; calls `connection()` to stay per-request; falls back to mock data when unconfigured |
| `app/actions/crm.ts` | 10 Server Actions (create + update per entity), returning `{ ok }` rather than throwing |
| `lib/store/provider.tsx` | `CRMStoreProvider` — builds one store per request **containing** the snapshot, so the server HTML and the hydration pass both render real rows; `useCRMStore` resolves it from context |

Reads happen once per full page load in `app/layout.tsx` (now `async`); client
navigation re-uses the store. Writes are optimistic — local state first, then
the Server Action, no awaiting. Record IDs are generated client-side so the
optimistic row and the stored row are the same row — via `newId()` in
`lib/utils.ts`, which prefers `crypto.randomUUID()` and falls back to a
timestamp+random string. **`crypto.randomUUID` is only defined in a secure
context**, so on a plain-HTTP LAN origin (the dev server also binds a network
address) it is `undefined` and a bare call would mint records with `id:
undefined`. Only `AddLeadModal` uses `newId()` so far — see Known issues.

**Runs without credentials.** No `.env.local` means demo data, a boot warning,
and writes that no-op. The UI is identical either way.

### Migrations & CLI (npm scripts)

| Script | Does |
|---|---|
| `npm run db:status` | dry run — lists migrations that would be applied |
| `npm run db:push` | applies pending migrations (`-- --include-seed` also runs `seed.sql`) |
| `npm run db:link -- --project-ref <ref>` | links the CLI to a project |
| `npm run supabase -- <cmd>` | any other CLI command, same scoped auth |

Migration files **must** be named `<14-digit-timestamp>_<name>.sql` — that is how
the CLI orders them and matches them against `supabase_migrations.schema_migrations`
on the remote. Create them with `npm run supabase -- migration new <name>`, never
by hand.

**Two Supabase accounts, one project.** This shaped the whole CLI setup. `supabase
login` writes an account-wide token to `~/.supabase/access-token`, and no
per-directory setting overrides it — so `supabase link` kept resolving to the
wrong account. `SUPABASE_ACCESS_TOKEN` *does* override that file, so the wrapper
injects it from `.env.local` per command. Verified: a wrong-but-well-formed token
returns `Unauthorized` rather than silently falling back to the other account.
`~/.supabase/access-token` does not exist and should stay that way.

**Never run bare `npx supabase link` or `supabase login`** — those read the global
token. Always go through `npm run supabase -- …`.

Every credential is project-scoped. The one exception is `SUPABASE_ACCESS_TOKEN`,
which is a full account credential (it can reach every project that account owns)
and is only needed for `link`; `SUPABASE_DB_URL` alone is enough for `db:push`.

### State Management (lib/store/)

| File | Role |
|---|---|
| `store.ts` | `createCRMStore(snapshot)` — the factory. Holds the `CRMStore` interface, the settings helpers, and a per-store write queue |
| `provider.tsx` | `CRMStoreProvider` + the `useCRMStore` hook (context-backed) |
| `index.ts` | barrel — keeps `import { useCRMStore } from '@/lib/store'` working unchanged across all 16 consumers |

**One store per request, built with the snapshot rather than filled afterwards.**
This is load-bearing, not a style choice: `useSyncExternalStore` renders both the
SSR pass and the client's hydration pass from `getInitialState()`, which Zustand
freezes at construction. A store populated after creation is invisible to both,
and only corrects once a subscriber notices — which is not guaranteed to happen
promptly. See the fixed entry under Known issues.

Every data mutation below also persists via the matching Server Action; failures
land in `syncError` and are logged, without rolling back the optimistic change.
Actions:
- `addOpportunity` — new lead from capture modal
- `addToPipeline` — sets `inPipeline: true` and resets stage to `'New'`
- `moveOpportunityStage` — drag/drop pipeline updates
- `addNote`, `dismissNote`, `applyNote` — inbox note management; apply updates matching opportunity
- `moveStrategyCard`, `addStrategyCard` — strategy board management
- `addTask`, `toggleTaskComplete` — task management
- `syncError` / `clearSyncError` — last failed write (set and logged, not yet rendered)
- `toggleSidebar`, `setSearchQuery` — UI state
- `toggleTheme`, `setSetting`, `resetSettings`, `hydrateSettings` — display preferences and interface language, persisted to `localStorage` key `khyte-settings` (`khyte-theme` is still read as a legacy fallback for pre-settings builds)

### Mock Data (lib/mock-data/)
No longer seeds the store. Two remaining jobs: the credential-free fallback in
`loadSnapshot()`, and the source the rows in `supabase/seed.sql` were written
from.

| File | Contents |
|---|---|
| `companies.ts` | 6 companies (Meridian Labs, Nordvik Capital, Calloway Systems, Sable Analytics, Fenwick Advisory, Orin Technologies) |
| `contacts.ts` | 6 contacts, one per company |
| `opportunities.ts` | 7 opportunities across various pipeline stages; all seeded `inPipeline: true` except `o5` and `o7` (off board, so the pipeline "Add Leads" picker has content) |
| `notes.ts` | 3 raw capture notes, 2 with AI extraction |
| `strategy.ts` | 10 strategy cards for Nordvik Capital opportunity |
| `tasks.ts` | 8 realistic tasks linked to opportunities/companies, mix of overdue/today/upcoming/completed |

### Types (lib/types/index.ts)
- `Priority` — `'low' | 'medium' | 'high' | 'critical'`
- `Stage` — 9 pipeline stages
- `Company`, `Contact`, `Opportunity` (with `inPipeline` — leads only appear on the pipeline board once explicitly added), `Note` (with `dismissed`/`applied` fields), `StrategyCard`, `Task`
- `StrategyColumn` — 6 columns
- `PipelineStage`
- `Settings` — display preferences (`theme`, `currency`, `locale`, `dateFormat`, `compactNumbers`), plus `CurrencyCode`, `LocaleCode`, `DateFormat`

### Design System — "Darkroom Operator"
Two themes: **dark** (default) and **light**, toggled via Sun/Moon button in sidebar. Theme persists in `localStorage` as part of the settings blob (`khyte-settings`; the older `khyte-theme` key is still read as a fallback). Applied as `data-theme` attribute on `<html>`.

Palette philosophy: primary text is pure white (dark) / pure black (light) — no washed-out greys for main content. Secondary text and borders are deliberate mid-greys with strong contrast.

**Dark theme colors:**
- Background: `#171514` (main), `#1D1B19` (raised), `#242220` (surface), `#2B2926` (surface-raised) — warm charcoal, lifted from the original near-black
- Text: `#FFFFFF` (foreground), `#E2DDD6` (dim), `#B3ADA5` (muted), `#C4BFB8` (muted-foreground)
- Accent: `#D4943C` (amber), hover `#E0A554`
- Borders: `#7D7871` (primary), `#625E58` (subtle)
- Semantic: `danger` (#E05252), `success` (#4CAF72)

**Light theme colors (`[data-theme="light"]`):**
- Background: `#F7F5F1` (warm parchment, nudged cooler to match the reference palette), `#EFEBE4` (surface), `#E8E3DB` (surface-raised)
- Text: `#1C1B19` (foreground — softened off-black, no longer pure `#000000`), `#3D3935` (dim), `#6E6861` (muted), `#55504A` (muted-foreground)
- Accent: `#C4832A` (deepened for WCAG AA on light), hover `#D4943C`
- Borders: `#9A938A` (primary), `#B5AFA6` (subtle)
- Semantic: `danger` (#C94040), `success` (#3A8F5A)

**Grain surfaces (dashboard cards, sidebar, modals):**
- Shared tokens in `:root`: `--grain-hue: #8A3B0E` (Khyte burnt orange, sampled from brand art), `--grain-base-1/2` (card bases mixed 46–54% toward black in dark mode, 3–6% in light)
- A `[data-theme="dark"]` block duplicates `:root`'s dark values so any nested element can force the dark palette locally via a `data-theme="dark"` attribute, independent of the page-wide theme (used by the sidebar and modals below)
- `.grain-card` — 20px-radius card: burnt-orange radial glows over a darkened base gradient, amber-tinted border, film-grain overlay (7% dark / 5% light opacity), inset top highlight, no drop shadow. Still theme-adaptive (switches with the page)
- `.grain-nav` — same treatment edge-to-edge for the sidebar. **Deliberately declares no `position`** — unlayered CSS beats Tailwind utilities, and adding `position: relative` here would override the aside's `fixed` and double-offset every page. `AppSidebar`'s `<aside>` carries `data-theme="dark"` directly, so the rail always renders the dark grain treatment even when the rest of the app is in light mode
- `.grain-drawer` — layered *on top of* `.grain-modal` (the drawer carries both classes) so the material stays identical by construction; overrides geometry only: left-side border and radius, shadow cast leftward. **Restates `position: fixed`** — `.grain-modal` sets `position: relative` at equal specificity but later in the sheet, which silently beats Tailwind's `fixed` and parks the panel off-screen. Same trap the `.grain-nav` note describes
- `.grain-modal` — same recipe for the capture modals, plus a drop shadow. **No `overflow: hidden`** (combobox dropdowns must escape the panel); the grain layer clips via `border-radius: inherit` instead. The modal panel also carries `data-theme="dark"`, so capture modals always render dark, matching the sidebar
  - **`background-color` is set separately from `background-image`.** All three grain layers fade to `transparent`, so with only the shorthand the backdrop read straight through the panel wherever the gradients fell off. Worse on browsers without `color-mix`: Turbopack emits a fallback branch whose stops are raw `--grain-hue`, making the panel markedly more see-through there than in Chrome. An opaque `background-color: var(--grain-base-2)` under the gradients seals it
  - `.grain-modal > *` lifts section content above the grain `::before`, but giving every direct child `position: relative` + `z-index` **makes each section its own stacking context** — a popover inside one section cannot stack above a later sibling no matter its `z-index`, so combobox dropdowns rendered *behind* the sections below them. `.grain-modal > [data-layer-raised]` is the opt-out; `Combobox` flags its own enclosing section while its list is open and clears it on close
  - The `::before` noise tile carries `transform: translateZ(0)` + `will-change` + `contain: strict`, and `body::before` the same promotion. Rasterizing `feTurbulence` is expensive, and unpromoted these forced a repaint of the whole grain surface (and, for `body::before` at `z-index: 9999`, the whole viewport) on every keystroke in a modal field

**Typography:**
- Display: Instrument Serif (page headings, empty states — warm, editorial) via `.font-display`
- Dialog titles: Plus Jakarta Sans semibold at `tracking-[-0.02em]` via `.font-jakarta` (`Modal`, `DetailDrawer`, `ConfirmDialog`). Sized 20px rather than the serif's 21px — a semibold geometric sans carries more visual weight than 400-weight Instrument Serif at the same size, and held at 21px it competed with the section headers below it
- Dashboard chat greeting only: Source Serif 4 at weight 380 (`.font-headline`) — thinner, cleaner serif scoped to this one headline, not a global type-scale change. Chosen as a licensable stand-in for Anthropic's proprietary "Anthropic Serif" (can't embed that font without a license)
- Body: Geist Sans; dashboard uses Satoshi (loaded from Fontshare in `layout.tsx`)
- Headline/numeric: Barlow (dashboard card headers, deal values)
- Data/Labels: Geist Mono (uppercase, tracked, 10px — via `.label-mono` utility)

**Effects:**
- Film grain noise overlay via SVG filter on `body::before`
- Card hover glow: `.card-glow` (subtle amber shadow on hover)
- Gradient line dividers: `.line-accent`
- Pulsing indicator: `.ember-dot`
- Animations: fadeInUp, slideInDown, scaleIn, glow-pulse, line-reveal, ember-glow
- Staggered children reveal with 50ms delays
- Smooth cubic-bezier easings throughout
- `color-scheme: dark` / `light` set per theme on the root — native widgets (date picker icon, scrollbars) match the active theme

**Layout:**
- Sidebar: 232px expanded → 64px collapsed
- Topbar: 52px sticky with backdrop blur
- Drawers: always-mounted, slide via translate-x with `cubic-bezier(0.16, 1, 0.3, 1)`
- Overlay: `bg-black/40 backdrop-blur-[3px]`

---

## What does NOT exist yet

- Authentication — the Server Actions in `app/actions/crm.ts` are therefore
  unauthenticated write endpoints, reachable by direct POST. Keep the app local
  or access-controlled until this lands.
- Delete flows (the data layer covers create + update, matching what the UI does)
- Realtime — two open tabs do not see each other's changes until reload
- Surfacing failed writes in the UI (`syncError` is set and logged, nothing renders it)
- Real AI extraction (mocked — picks random extraction for notes > 30 chars)
- Email / calendar sync
- Notifications
- Advanced cell editing in table
- Edit flows for companies, contacts, opportunities (add modals exist). The one exception is **opportunity notes**, editable inline in `DetailDrawer`; every other field is still read-only once created
- Mobile optimization beyond basic responsive layout
- Loading states, and per-route `error.tsx` boundaries (only the root `global-error.tsx` exists)

---

## Next logical steps (not started)

1. **Auth** — Supabase Auth; then set `owner_id` on insert and swap the secret-key
   client for a session-scoped one on the publishable key (see `docs/database.md`).
   The per-request store this also required is already done — see State Management
2. **Surface `syncError`** — a toast, so a failed save is visible without the console
3. **AI extraction** — hook CaptureBox submit to Claude API via server action
4. **Edit flows** — edit drawers for companies, contacts, opportunities (add modals done)
5. **Real-time** — Supabase realtime subscriptions for pipeline updates
6. **Motion library integration** — replace CSS animations with motion for richer interactions

---

## Known issues / open decisions

- ~~No data persistence — all state resets on page refresh~~ — fixed: the store
  hydrates from Postgres and writes back through Server Actions. Still resets on
  refresh if no `.env.local` is present, which is the intended demo-mode behaviour
- ~~Pages render empty until the client store fills, sometimes never~~ — fixed
  2026-08-21. Every store-backed page server-rendered its empty state (`/leads`
  shipped `No leads match the current filters.` and zero table rows), and the
  real data only appeared once a subscriber noticed the store had changed. That
  check lives in a passive effect, so a backgrounded tab could defer it
  indefinitely — the page would sit at "0 of 0 opportunities" until you switched
  back to the tab. Cause: `StoreHydrator` wrote the snapshot in *after* the store
  was created, but `useSyncExternalStore` renders SSR and hydration from
  `getInitialState()`, which Zustand fixes at construction. Fix: build the store
  with the snapshot (see State Management). `/leads` now server-renders all 7
  rows. This also removed the shared-singleton-across-requests problem that would
  have leaked one operator's data into another's render once auth landed
- **Use the Session pooler connection string, not Direct connection.**
  `db.<ref>.supabase.co` resolves to IPv6 only; on an IPv4 network the CLI fails
  with `getaddrinfo ENOTFOUND`, which reads like a wrong project ref but is not.
  `aws-0-<region>.pooler.supabase.com` has an A record and works. The pooler
  username is `postgres.<project-ref>`, not plain `postgres`
- **PowerShell makes a successful `db:push` look like a crash.** The CLI writes
  progress to stderr, and PowerShell renders any native-command stderr as a red
  `NativeCommandError` block. The trailing JSON line is the real result — check
  that before assuming failure
- Passwords in `SUPABASE_DB_URL` must be percent-encoded (`@` → `%40`).
  `db:push` validates this and rejects a leftover `[YOUR-PASSWORD]` placeholder,
  because both failure modes otherwise surface as an opaque auth error
- Optimistic writes are never rolled back. A failed save leaves the change on
  screen and only records it in `syncError` — deliberate (snapping a dropped
  kanban card back is worse), but it means the UI can drift from the database
  until reload
- The store is built once per provider mount and a *later* snapshot is ignored,
  so there is no way to re-read the database short of a full page load. Adding a
  `router.refresh()` would silently do nothing. Same behaviour as the
  `StoreHydrator` it replaced, but the provider is now the only path data takes
  in, so the assumption carries more weight
- `.stagger-children` (globals.css) sets per-`nth-child` animation delays with
  `both` fill. Filtering or searching shifts each card's index, which changes the
  delay, which restarts the animation from `opacity: 0` — so cards blink when the
  list is filtered. Cosmetic, unfixed
- If the database is configured but unreachable, `loadSnapshot()` throws and the
  whole app fails rather than degrading — deliberate, so a broken connection is
  loud. `app/global-error.tsx` now catches it (see Error handling below); the
  app still refuses to fall back to demo data, because silently serving fake
  pipeline numbers is worse than showing nothing
- No loading states, and no segment-level `error.tsx` boundaries — `global-error`
  is the only one, so any route failure takes the whole page rather than just
  that section
- No mobile optimization beyond basic responsive layout
- Dashboard chat is mock-only (canned replies matched on keywords); mic dictation depends on the browser's Web Speech API (works in Chrome/Edge, silent no-op elsewhere)
- `CaptureBox` / `SuggestionPreviewCard` are orphaned since `/inbox` was removed — reuse or delete when the capture flow finds a new home
- ~~Capture modals (lead/contact/company) are a functional first pass — a hand polish pass on the design comes later~~ — **`AddLeadModal` has now had that pass** (2026-08-21): transparency fix, portal + focus trap, keyboard-complete combobox, priority `ColorSlider`, Jakarta title, +2px type scale, inline validation. `AddContactModal` / `AddCompanyModal` inherit the shared `Modal` and `FormFields` improvements but have **not** had their own layout pass
- **Settings are per-browser, not per-account.** They live in `localStorage`
  (`khyte-settings`), so they do not follow the operator to another machine and
  there is no server-side record of them. Revisit when auth lands
- **Settings apply after first paint, deliberately.** `hydrateSettings()` runs in
  an effect rather than during render, because localStorage is invisible to the
  server — reading it during render would make the first client paint disagree
  with the server HTML on every formatted amount and date. The cost is a brief
  flash of the Swedish defaults on a hard load before saved preferences apply.
  Same trade-off the theme toggle already made
- Native `<select>` is unusable in this design system — Chrome renders the option
  popup with OS chrome that ignores the page palette, which came out white-on-white
  in dark mode. `/settings` uses a custom dropdown built on the `Combobox` popover
  pattern instead. Worth remembering before reaching for a native select elsewhere
- ~~**Supabase intermittently rejects reads with `JWT issued at future`**, taking
  the whole page down via the loud-failure path~~ — mitigated 2026-08-21 with a
  bounded retry (`lib/db/retry.ts`), wired into `loadSnapshot()` and the `run()`
  write funnel. **The earlier "fix your system clock" diagnosis was wrong**: this
  machine and the API `Date` header agree to within ~2s, and six consecutive
  direct reads all succeeded. The app never mints a token — the secret key is an
  opaque `sb_secret_…` that the gateway exchanges for a short-lived JWT per
  request — so the skew is between Supabase's own services and is not fixable
  here. Reads retry the full transient set; writes retry auth-timing faults only,
  because a dropped connection may mean the write landed and only the response
  was lost. Three attempts, 200ms/400ms backoff; anything non-transient still
  fails on the first try. Not a cure — a blip longer than ~600ms still surfaces,
  but `app/global-error.tsx` now catches it with a retry button instead of a
  blank page
- Adding a lead from the pipeline "Add Leads" picker resets its stage to "New" even if it was further along — intentional per spec, revisit if it feels wrong in use
- **Seven call sites still call `crypto.randomUUID()` directly** instead of
  `newId()` — `AddCompanyModal`, `AddContactModal` (×2), `CaptureBox`,
  `StrategyBoard`, `dashboard/page` (×2), `tasks/page`. They mint `id: undefined`
  when the app is opened over plain HTTP on a LAN address rather than
  `localhost`. Harmless on localhost and in production over HTTPS; a one-line
  swap each when someone is in those files
- Strategy board cards state is duplicated (local + Zustand) — needs reconciliation
- ~~Pipeline board also duplicates opportunity state locally for drag/drop~~ — fixed: board now derives cards straight from store-backed props
- `layout.tsx`'s `Source_Serif_4` font config has no `weight` set, which Turbopack rejects ("Unknown weight 200 900 for font Source Serif 4") — shows as a dev-overlay build issue; needs an explicit `weight` array to resolve
- Sidebar and capture modals are now permanently dark-styled regardless of the page theme (see Design System note above); Topbar and regular content cards still switch with the theme toggle — revisit if the split ever feels inconsistent
