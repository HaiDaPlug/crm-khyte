# Khyte CRM — Current State

**Date:** 2026-09-01
**Phase:** MVP + persistence + password gate + derived direction board +
cross-browser live sync
(Supabase live; shared-password auth, no accounts)

The database is provisioned and running. Project ref `wmnobqhypkocirfybqsj`
(eu-north-1); schema and seed applied; reads and writes verified end to end
against the live API.

**Migrations, current state.** `20260829120000_opportunity_sort_order` is
applied (`opportunities.sort_order`, backfilled per-stage from the existing
visual order — see Pipeline board interaction). `20260830120000_goal_target_date`
and `20260830130000_company_enrichment` are now **applied** — all 15 files in
`supabase/migrations/` were, verified against
`supabase_migrations.schema_migrations` on 2026-08-31.
`20260901120000_stage_ongoing` and `20260901120100_stage_ongoing_backfill`
(the `New`/`Ongoing` stage rename — see Pipeline board interaction) are
**written but not yet pushed**; `npm run db:push -- --dry-run` confirms these
are the only two pending files.
`20260830120000` originally tried to add the `goal` enum value and read it
back (`update ... set section = 'goal'`) in one file, which Postgres rejects
(`SQLSTATE 55P04` — a freshly added enum value cannot be used in the same
transaction that added it). Split into `20260830120000_goal_target_date`
(just the enum add) and `20260830120100_goal_target_date_backfill` (the
column and the backfill) — see Known issues for why the earlier
`weekly_goal_section` migration's claim that this split was unnecessary was
wrong. Earlier for
the direction board: `20260828120000_personal_goals` (renames `focus_items`,
adds `target_date` and `progress`), `20260828140000_crm_events` (the activity
log and the weekly archive) and `20260828140100_weekly_goal_section` (the
`weekly` goal section plus `metric_kind`/`metric_target`) — all applied.

**The board's numbers are now computed, not typed.** Revenue, customers and
pipeline are recomputed from `opportunities` on every read, and the weekly
non-negotiables are counted from `crm_events`. Nothing on the wallpaper can
drift from what the CRM holds — which also means it reads 0 revenue until deals
are actually marked Won.

**Outreach is counted on arrival, not only on movement (2026-09-01).** The
counters had been reading close to zero — 3 prospects contacted in a week the
team had made 19 — because activity was recorded only when an opportunity's
stage *changed*, and this team enters a company *after* calling it, filed
straight into `Contacted`. Creation logged nothing at all. Prospects created at
a stage now record the thresholds they arrive past, dated by `lastInteraction`
so a prospect you called last week credits last week, deduped per prospect per
day so logging the same call both ways counts once. `/goals` also now displays
the weekly counts it had been receiving and discarding, and refreshes itself
instead of freezing at first render. See Derived board metrics and Direction
editor live updates.

---

## What exists

### Stack
- Next.js 16.2.1 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Supabase (`@supabase/supabase-js`) — hosted Postgres; schema in `supabase/migrations/`, setup in `docs/database.md`. Writes go through PostgREST; reads bypass it entirely (see Data Layer)
- `postgres` (postgres.js) — direct Postgres client for `loadSnapshot()`'s reads, over `SUPABASE_DB_URL`
- Supabase CLI 2.115 (devDependency) — migrations via `npm run db:push`. Auth is sourced from `.env.local`, never `~/.supabase`, so the CLI cannot drift to a second Supabase account
- Zustand — global state management (one store per request, built with the database snapshot; writes through Server Actions)
- @dnd-kit/core + sortable + utilities — drag/drop
- @tanstack/react-table 8 — table shell
- lucide-react — icons
- Radix UI primitives (dialog, dropdown, separator, slot, tooltip)
- motion (framer-motion successor) — task check-off/column-flight animation
- clsx + tailwind-merge + class-variance-authority — style utilities

### Routes
| Route | Status | Notes |
|---|---|---|
| `/login` | Functional | The password gate. Renders outside `AppShell` — no sidebar, no store, no database read. Single autofocused password field, `useActionState` error states (empty / invalid / throttled), `noindex`. See Auth gate |
| `/` | Done | Redirects to `/dashboard` |
| `/dashboard` | Functional | Command-center home. Desktop keeps the split pipeline/tasks + assistant composition; mobile switches to assistant-first reading order and natural vertical scrolling, with responsive greeting, composer, quick prompts and cards. The composer still supports Enter submit, autosize, mic dictation via Web Speech API, and mock replies keyed off lead names. |
| `/leads` | Functional | **Carries a pair of count cards above the grid, right-aligned — "I dag" (bare tally) and "Denna vecka" (against the `lead_added` target) (2026-09-02)** — see Weekly progress cards + quick filters below. New, lightweight raw-interest inbox — a card grid, not the table/board pair below. No Company/Contact/Opportunity record exists until a lead is promoted. **Gained a search bar 2026-09-01**, the same `SearchInput` as `/prospects` and likewise on page-local state. This page had been reading the store's global `searchQuery` — which nothing set, so the filter never ran — and matching company name only; it now also matches contact name, connection, source and notes, i.e. everything the card and drawer actually render, so what you can read you can search. The empty state now splits: a no-results panel with a "clear search" action when a query is active, the original "no leads yet" prompt otherwise — previously a search that matched nothing claimed the inbox was empty. Clicking a card opens an inline `LeadDrawer` (defined in `app/leads/page.tsx`) showing the full record — including source, which the card doesn't show — with a "promote to prospect" button and a `Trash2` delete button (behind a `ConfirmDialog`, permanent via `removeLead`); each card also carries its own promote action. **Contact name, source and notes are now click-to-edit inline** in the drawer, mirroring `DetailDrawer`'s one-field-at-a-time editor exactly (single `editingField` state, commit on blur/Enter, Escape cancels the field rather than closing the drawer via `shouldIgnoreEscape`) — previously all three were plain read-only text with no way to fix a typo or add notes after capture short of deleting and re-adding the lead. Priority, connection and followed-by remain read-only from this drawer (unchanged, out of scope). "New Lead" (`AddLeadModal.tsx`) is a small single-column form: company name (required), contact name, connection ("koppling" — someone in your network who knows the contact), source, "Tillagd av"/"Added by" via `AssigneePicker` (semantically who added the lead, not who's following it up), priority via `ColorSlider`, notes. Promoting opens `AddProspectModal` pre-filled via `fromLeadId`; submitting deletes the lead (`removeLead`) rather than keeping it around alongside the new Prospect. |
| `/prospects` | Functional | **Carries a pair of count cards right-aligned on the filter row directly above the table — "I dag" (bare tally) and "Denna vecka" (against the `prospect_contacted` target) — plus a row of quick-filter chips (2026-09-02)** — see Weekly progress cards + quick filters below. Renamed from the old `/leads`; unchanged in behavior. TanStack sorting/filtering plus board view and detail drawer. At `< md`, the dense table becomes purpose-built cards; the board uses phone-width snap columns with a next-column peek. **Header also carries an "Export contacted" button (2026-09-01)** — downloads every already-approached company as CSV for feeding to an AI that should skip them; see Contacted-prospect export below for what "contacted" means and why it ignores the page's own filters. **Search is now reachable (2026-09-01).** The match logic had been wired all along but nothing rendered an input — it read the store's global `searchQuery`, which no live page ever set, so the feature was dead code and this line previously claimed it was "wired" on the strength of the filter alone. A `SearchInput` now sits beside the `FilterBar`, backed by page-local state rather than that store field (one shared field means a query typed here would follow you to `/leads` and silently filter it too — the store's `searchQuery`/`setSearchQuery` remain, still referenced only by the two archived pages). Matching widened from company/contact/next-step to also cover the contact's role, and the query is trimmed before comparison. Filters and table/board empty results show localized recovery guidance instead of blank space. "New Prospect" (`AddProspectModal.tsx`) uses labelled company/contact comboboxes and a single-column mobile form; selecting a pipeline stage adds the prospect to the board. It also gained an optional "start from a lead" search combobox (only rendered when `leads.length > 0`) that pre-fills company name, contact name, priority and notes from a Lead — see `/leads` above. **Also gained a "Senaste kontakt" (last-contact) date field**, editable both at capture time (defaulting to today, same as the value every prospect used to get baked in silently) and afterward — see `Opportunity.lastInteraction` under Components: `DetailDrawer.tsx` below; before this it was write-once and could never be corrected or bumped forward without editing the database directly. **The table now pages at 10 rows**, with the
pager at the top of the table rather than the foot — the full list arrived as
one undifferentiated scroll once real prospects were loaded. **The
Pipeline/"På tavlan" column has been replaced by "Tillagd"**, showing the
colleague who added the prospect (`Opportunity.followedUpBy`, the same field
`DetailDrawer` labels "Följt upp av"): every prospect is on the board, so the
old column carried no information. **The follow-up date is no longer
prefilled** — `AddProspectModal` used to bake in today + 7 days, which meant
every prospect carried a follow-up nobody had chosen; it now opens empty and
blank dates render as `—` wherever they appear. |
| `/pipeline` | Functional | Nine-stage dnd-kit kanban with mouse, delayed long-press touch and keyboard sensors. Mobile columns snap horizontally, expose a next-column peek/edge cue, and use natural page height instead of a locked viewport. Active value, drop feedback, off-board picker, background panning and drag-edge auto-scroll remain intact. Source data is Opportunities (Prospects), not the new Leads. |
| `/strategy` | Functional | Opportunity selector + per-deal strategy board with add/rename/delete. The selector, summary and empty state reflow on phones; board columns snap/peek horizontally, touch actions stay visible, and drag supports mouse, long-press touch and keyboard input. |
| `/goals` | Functional | **Khyte-internal**, not a CRM feature — the company direction board. Structured editor (no canvas): optional north star, one merged **`goal`** family (former `annual`+`quarter`, each with an optional `targetDate` — see Goals timeline below), weekly non-negotiables, scoreboard, per-colleague personal goals, principles, "not now". Fields commit on blur and persist through `app/actions/goals.ts`; state is local to the component rather than in the CRM store, because goals are loaded by `loadGoals()` not `loadSnapshot()`. The scoreboard is **read-only for actuals** — it shows the figure the CRM computes and only the target is editable, because the board stopped reading `currentValue` when the figures became derived. Its three rows are fixed (Intäkt / Pipeline / Kunder), matched to `DisplayBoard` by label. **Weekly non-negotiables now show their live count** beside the target, resolved exactly as `DisplayBoard` resolves it — the page had been handed `weeklyCounts` all along and rendered none of it, so a week of recorded outreach was invisible here no matter how often you reloaded. The page also keeps itself current now rather than freezing at first render; see Direction editor live updates below. Top of the page carries the copyable wallpaper links, one per colleague, plus a link to `/goals/timeline`. |
| `/goals/timeline` | Functional | New. Read view of every `goal`-family row, grouped by a period derived from its `targetDate` (see Goals timeline below) rather than by the `sort_order` the editor lists them in — the thing this page exists to answer is "what's coming up soonest", which the editor cannot show at all. No editing here; `GoalsEditor` already owns writes to these rows, and duplicating that would just be a second place the same field could go stale. |
| `/goals/display/[colleague]` | Functional | The wallpaper. Fills the screen edge to edge (no letterboxing) with zero chrome, rendered outside `AppShell` and sized off a single `--u` unit blending `vw` and `vh`, so the composition scales whole to any monitor. Bento header: the wordmark left (scaled up, swapped from the bare K mark), three enlarged KPI tiles right with bolder eyebrow labels, a gradient divider beneath the header. The north star statement no longer renders here (see Goals timeline below — its section/editor/DB rows are untouched, it's just not drawn). Below the divider, three columns separated by hairline dividers between rows — the `goal` family's three soonest-by-date entries, this week's counted non-negotiables, and the viewer's own personal goals — every list hard-capped at three rows. Checks a version stamp every 5s and reloads only on change, with an unconditional 5-minute reload as backstop (`BoardRefresh.tsx`). Reachable with a session or a signed `?k=` display token. |
| `/companies` | **Archived** | Not deleted — moved to `_archived/app/companies/page.tsx`, outside the `app/` tree so Next stops routing it. Not linked from the sidebar (`AppSidebar.tsx`'s `navItems`, shared with `MobileChrome.tsx`) either. `AddCompanyModal.tsx` and the companies mock data are untouched and now unused until the page is restored. Prior description, kept for when it comes back: responsive card grid with deal/contact counts and total value, search with localized no-result state, full-screen mobile detail dialog, three enrichment fields (revenue/employee count/about) — see Company enrichment fields below. |
| `/contacts` | **Archived** | Same treatment as `/companies` — moved to `_archived/app/contacts/page.tsx`, delinked from the sidebar. `AddContactModal.tsx` and the contacts mock data are untouched. Prior description: responsive list with search/localized no-result recovery, full-screen mobile detail dialog, single-column "New Contact" modal. |
| `/tasks` | Functional | Three derived groups — **On pace / Late / Completed** — stack vertically below `lg`. Completion controls have accessible names/states and 44px hit areas; the inline editor no longer hijacks Enter from nested buttons. `AddTaskModal` is single-column on phones with labelled fields, readable date control and stacked actions. Archive/delete behavior is unchanged. The board itself now lives in `components/crm/TaskBoard.tsx` (extracted so `/tasks/[colleagueId]` can reuse it — see Tasks below), and the header carries a `ColleaguePicker` dropdown next to "Add Task" for jumping to a colleague's filtered view. |
| `/tasks/[colleagueId]` | Functional | New. Same three-column board, filtered to one colleague's tasks (`erik`/`abdi`/`hai`) via `task.assignee`. Server component validates the segment against `COLLEAGUE_IDS` and 404s on an unknown one, same convention as `/goals/display/[colleague]`; the actual filtering/rendering happens in the client `ColleagueTasksView.tsx`, since tasks live in the client-side store, not a server read. Header shows the colleague's avatar/name instead of "Tasks". |
| `/settings` | Functional | Display preferences remain app-wide and `localStorage`-backed. The page now uses responsive cards, stacked controls and mobile-safe spacing while preserving dark/light, language, locale, currency, date, compact-number and sound settings. |

### Components
```
components/
  layout/
    AppShell.tsx       — client wrapper; mounts `CRMStoreProvider`, applies theme/language settings, reserves mobile top/bottom chrome space, adds horizontal safe-area insets, and closes the mobile menu on route change or when crossing into the desktop breakpoint
    AppSidebar.tsx     — desktop-only (`lg+`) 232px → 64px collapsible sidebar; grain-nav burnt-orange treatment, theme toggle and shared exported nav definition used by the mobile chrome. The footer's "Arbetsyta"/khyte.io workspace-identity block is gone from this desktop sidebar (unused chrome); `MobileChrome.tsx`'s own copy of the same block is untouched — that is a separate mobile nav drawer, not this component. `navItems` no longer lists Companies/Contacts — see Routes above
    MobileChrome.tsx   — fixed mobile header + five-item bottom navigation (Dashboard, Prospects, Pipeline, Tasks, More). `primaryHrefs` lists `/prospects`, not the new lightweight `/leads` — Leads is reachable only via the `More` drawer. `More` opens an inert-while-closed, focus-trapped, Escape-dismissible navigation drawer with theme control; all chrome handles top/bottom/left/right safe-area insets
    Topbar.tsx         — optional sticky action bar; returns `null` when a route supplies no actions
  crm/
    CaptureBox.tsx     — textarea input, Cmd+Enter submit, simulated AI extraction (800ms delay) — orphaned since /inbox was removed
    SuggestionPreviewCard.tsx — AI extraction card with Apply (updates matching opportunity) / Dismiss — orphaned since /inbox was removed
    CRMTable.tsx       — sortable TanStack table at `md+`, backing `/prospects`; paged at 10 rows with the pager above the table (`getPaginationRowModel`, `autoResetPageIndex: false` plus a clamp, so saving an edit does not throw the user back to page 1); purpose-built mobile cards below `md` surface company, stage, contact, value, next step, follow-up, who added it and priority without horizontal page overflow. **The company column is capped at 320px and wraps (2026-09-02).** Every `<td>` carried a blanket `whitespace-nowrap`, so one long name — "MakeClean AB Städföretag, flyttstäd - städfirma för hem och företag" — set the column's width by itself and stretched the rest of the row to fill, leaving dead space beside the short values. Only the company cell now gets `whitespace-normal`; stage tags, dates and the avatar row still stay on one line, where wrapping would read worse. The cap is declared on the `<th>` *and* the `<td>` — with auto table layout a max-width on the inner `div` alone does not hold, since the column still grows to its widest content — plus `[overflow-wrap:anywhere]` so a single long unbroken word cannot escape it either. 320px was measured, not guessed: rendered headless at 1462px, 280px pushed that name to three lines while 320px settles it at two and still hands ~45px back to the other columns. Wrapped rather than truncated because a cut-off company name is often unidentifiable, and this is the column the table is scanned by. The mobile card had the same problem in truncated form (one line, ending "flyttstäd -…") and now clamps to two lines instead
    PipelineBoard.tsx  — dnd-kit kanban with mouse, delayed touch and keyboard sensors, drag overlay/drop feedback, mobile snap/peek columns and natural phone height. Shared `useBoardPan` and `useEdgeAutoScroll` behavior remains; empty slots still open the stage-scoped off-board picker
    LeadCard.tsx       — touch-safe kanban card with mobile-sized type/controls, visible focus treatment, company/contact/priority/value and amber hover glow
    StrategyBoard.tsx  — store-derived dnd-kit strategy board with mouse/touch/keyboard sensors, mobile snap/peek columns, visible phone actions, and responsive inline add/rename forms
    DetailDrawer.tsx   — portaled slide-in drawer; full-width/full-`dvh` with square edges and left/right/top/bottom safe-area handling on phones, 520px on desktop. `role="dialog"`, focus trap, initial focus, Escape, body-scroll lock, focus return, `aria-hidden`/`inert` closed state and labelled inline editors. Retains its payload for the exit animation. Company name (h2 header) and Primary Contact's name are click-to-edit inline text fields that write through to the shared `Company`/`Contact` records via `updateCompany`/`updateContact`. Stage and Priority are inline-edited via the new `InlineSelect` popover (commits immediately, no draft). A 5th Deal tile, "Followed up by" (`followedUpBy` on Opportunity — who on the team is following this prospect up), is also an `InlineSelect`, using `''` as an unassigned sentinel since the component needs a real string value. Notes are a running, deletable log rather than one field to overwrite: a small compose textarea (⌘↵ or a button) calls `addNote()`, each submission becomes its own timeline entry, and the timeline renders a hover-visible delete button per entry via `NotesTimeline`'s `onDelete`. The old single-field notes editor and its dirty/discard `ConfirmDialog` flow are gone entirely. The footer now also carries a delete (`Trash2`) button behind a `ConfirmDialog` — permanent, calls `removeOpportunity` then closes the drawer; the database cascades notes/strategy cards, and the store prunes both locally the same way `removeStrategyColumn` already did. "Senaste kontakt" (`lastInteraction`) in the footer is now also click-to-edit inline (a `type="date"` input, same pattern as `followUpDate`'s editor) — it used to be set once at creation by `AddProspectModal` and never touched again
    NotesTimeline.tsx  — chronological notes with AI-extracted indicator; takes an optional `onDelete?: (noteId: string) => void` that renders a hover-visible `Trash2` delete button per entry (omit the prop for a read-only timeline)
    FilterBar.tsx      — stage + priority filters with semantic expanded/pressed state, inert collapsed content, horizontally scrollable mobile chips and 44px phone targets
    WeeklyProgressCard.tsx — exports two cards for one `metricKind`: `WeeklyProgressCard` (count against the `/goals` target, with a bar) and `DailyCountCard` (today's bare tally, no target, always renders including at 0). Both read one shared module-scope payload and 60s poll, so a page with both runs a single timer. The week card renders nothing when no weekly goal is bound to the metric; either renders nothing if the fetch fails
    QuickFilters.tsx   — preset chips over the prospects table (this week / needs follow-up / hot). Composes with `FilterBar` rather than replacing it; filtering by person lives on the count cards, which show each person's number as well
    (export lives in lib/export-prospects.ts, not components/ — it renders no UI; `/prospects` owns the one button that calls it)
    SearchInput.tsx    — the search field shared by `/prospects` and `/leads`. Controlled (`value`/`onChange`), with a leading magnifier and a clear button that appears only once there's a query. `type="search"` so phones offer the search key, but the WebKit-only native clear affordance is suppressed in favour of the explicit button — it's the only one that exists cross-browser and the only one that routes through `onChange`. Each page owns its own query state; the component holds none
    ViewToggle.tsx     — labelled table/board toggle group with pressed states and full-width phone layout
    EmptyState.tsx     — centered empty state with icon + message
    Modal.tsx          — safe-area-aware portaled modal shell, unmounted when closed; phone gutters, responsive title/spacing and stacked full-width mobile footer. Shared `useDialogBehavior` supplies focus trap, Escape, scroll lock and focus return; title labelling and nested-dialog suspension remain. The scroll container keeps pointer events and owns close-on-press; the backdrop is now purely the scrim — see Known issues for why
    ConfirmDialog.tsx  — safe-area-aware `role="alertdialog"` with stacked full-width phone actions and focus on the safe choice
    FormFields.tsx     — shared mobile-safe form primitives. Inputs are 44px/16px on phones (prevents iOS focus zoom); all modal `Field` labels are wired to stable control IDs, comboboxes retain full keyboard/listbox semantics, `AssigneePicker` has labelled group semantics, and `ColorSlider`/`DateStepper` remain keyboard operable. Gained `InlineSelect<T extends string>` — a small dark popover (button + absolutely-positioned `role="listbox"`, click-outside-to-close) standing in for native `<select>`; used by `DetailDrawer` for Stage/Priority/Followed-up-by, the general-purpose version of the popover pattern `/settings` already used
    AddLeadModal.tsx   — now the lightweight capture form for the new raw-interest `Lead` entity (company name required, contact name, connection, source, "Tillagd av"/Added-by via `AssigneePicker`, priority via `ColorSlider`, notes). No dirty-tracking or discard confirmation — it's a small form with little to lose. This filename previously held the rich Opportunity-capture modal; that component's content moved to the new `AddProspectModal.tsx` below
    AddProspectModal.tsx — the rich capture modal (renamed from the old `AddLeadModal.tsx`, unchanged behavior): single-column phone grids, 44px stage choices, labelled company/contact comboboxes, two-way autofill, pipeline membership, priority/deal/next step/follow-up/tags/notes, inline value/email validation and unsaved-changes confirmation (dirty-tracking + `ConfirmDialog`) all remain. Widened `w-[860px]` → `w-[1120px]`; the stage pill row is now `sm:flex-nowrap`/`whitespace-nowrap` so all 10 stage pills fit one line at desktop width instead of wrapping. Gained an optional "start from a lead" `Combobox` (shown only when `leads.length > 0`) that pre-fills company name/contact name/priority/notes from a `Lead` — folding the lead's connection/source into the notes text, since Opportunity has no dedicated field for either — and a `fromLeadId?: string | null` prop to open pre-filled directly. Submitting while promoted from a lead calls `removeLead(leadId)`, deleting it
    AddContactModal.tsx — contact essentials in a single-column phone layout; labelled company combobox, mobile email/phone/URL keyboards and stacked actions. Unused since `/contacts` was archived (see Routes) — its only caller was that page
    AddCompanyModal.tsx — company essentials in a single-column phone layout with labelled fields, URL keyboard hint and stacked actions. Unused since `/companies` was archived (see Routes) — its only caller was that page
    AddTaskModal.tsx   — single-column phone task capture with labelled title/description/date/assignee controls, responsive priority/date layout and stacked actions
    TaskBoard.tsx      — the three-column task board (On pace / Late / Completed) plus archive drawer, extracted from `app/tasks/page.tsx` so `/tasks` and `/tasks/[colleagueId]` render identical behavior off a `tasks: Task[]` prop instead of duplicating ~500 lines. Also exports `taskCounts()` for the header summary line. See Tasks below
    ColleaguePicker.tsx — header dropdown for switching between the shared task board and a colleague's filtered one (`/tasks` ↔ `/tasks/[colleagueId]`). A plain popover (outside-click + Escape to close), not built on `useDialogBehavior` — that hook's focus trap and scroll lock are modal-dialog behavior, more than a small menu needs
    Button.tsx         — shared button with 44px touch targets and visible keyboard focus on phones; compact desktop sizes and grain variants remain unchanged
    ButtonGrainPatchy.tsx — byte-for-byte snapshot of an earlier, mottled grain treatment (`.btn-grain-patchy` in globals.css), kept for reference/reuse; not wired into any page
```

### Mobile UX and responsive behavior

- The shell switches at Tailwind's `lg` breakpoint. Below 1024px the desktop
  sidebar is removed from layout and `MobileChrome` provides a fixed header,
  four primary bottom-nav destinations and a `More` drawer for the full route
  set. At 1024px the mobile drawer closes automatically, body scroll unlocks,
  and the 232px/64px desktop sidebar takes over.
- `app/layout.tsx` exports a device-width viewport with `viewportFit: 'cover'`
  and theme-aware browser chrome. `AppShell`, mobile navigation, global error,
  modals, confirmations and full-screen drawers all account for horizontal and
  vertical safe-area insets, including landscape notches.
- Mobile pages use natural vertical scrolling and responsive gutters instead of
  desktop viewport locks. Dashboard is assistant-first; Companies, Contacts,
  Tasks and Settings stack their controls/content; filtered Companies, Contacts
  and Prospects-board results render localized empty guidance and a clear action.
- Dense CRM data changes representation rather than merely shrinking: the
  Prospects table becomes cards below `md`, while Pipeline/Strategy use
  horizontally snapping columns with an intentional next-column peek and edge
  cue.
- Touch targets are at least 44px for primary mobile controls. Text inputs are
  16px to avoid iOS focus zoom. Form labels use stable `htmlFor`/`id` pairs;
  task completion exposes accessible names/pressed states; mobile menus,
  drawers and dialogs trap focus, close on Escape, lock background scroll and
  restore focus to their opener.
- Board dragging has explicit mouse, delayed long-press touch (250ms / 8px
  tolerance) and keyboard sensors. Desktop background/wheel panning and edge
  auto-scroll are preserved.

**Verification (2026-08-25):** `next build`, TypeScript and `git diff --check`
pass. All eight primary routes were checked at 320px with no page-level
horizontal overflow; representative flows were also checked at 390px, 820px,
1023/1024px and 1440px in dark and light themes. Mobile navigation, forms,
drawers, focus return, note-discard confirmation, breakpoint handoff and empty
state recovery passed against the production bundle with no browser console
warnings/errors. The remaining validation item is physical iOS/Android feel for
long-press drag/drop and real hardware safe areas.

### Weekly progress cards + quick filters (2026-09-02)
The non-negotiables now show up where the work happens, not only on `/goals`.
Each of `/leads` and `/prospects` carries **a pair of cards**, right-aligned on
the last row before the rows they describe rather than beside the page heading —
the first placement crowded the title and truncated the label.

**Two periods, on purpose.** "Denna vecka" is counted against the target set on
`/goals` and fills a bar that turns green once met. "I dag" is a bare tally with
no target and no bar: a weekly number divided by five is a figure nobody agreed
to, and a morning that starts slowly is not a day being failed. The day card
therefore always renders, zero included — hiding it at 0 would make it appear
only on days already going well, which is the opposite of useful. Its bar slot
is an empty spacer so the two cards stay the same height without the day
pretending to have a target.

Both cards read one shared payload: the fetch and its 60s poll are hoisted to
module scope with a subscriber set, so two cards on a page do not run two
timers against the same endpoint.

**The targets are read, never set, here.** A card looks up the `weekly` goal
bound to its metric kind and renders that goal's target, so the cards,
`GoalsEditor` and `DisplayBoard` all resolve a number the same way and cannot
drift. A metric with no weekly goal (or no target) renders no *week* card rather
than inventing one — `deal_won` shows none for exactly that reason. The cards are
labelled by period ("Denna vecka" / "I dag") rather than by the goal's own title:
the page already says which metric it is about, and a user-written title like
"Prospekt kontaktade" truncated inside the card. The title still carries the
progressbar's accessible name. Counts are team-wide, matching what
`weeklyCounts` has always meant, and they count events rather than current state:
prospects contacted this week stays true after they progress or go Lost.

`loadWeeklyProgress()` returns `today` alongside `counts` — the same event log
over a narrower window, from **local** midnight, matching how `weekStart()` and
`isoDate()` treat a day. Getting that boundary wrong would file a late-evening
call in today's tally and last week's total.

**Per-person breakdown.** Either card opens a popover listing who did the work
and how much, via `countEventsByColleagueSince()`. Attribution is by
`crm_events.colleague`, recorded when the event happened, **not** by the
opportunity's current `followedUpBy`: the log records what each person did, and
reassigning a prospect must not move last week's calls between people. Picking
someone narrows the card to their number and shows a removable tag; clearing it
returns the team total. On `/prospects` the choice is the page's own
`colleagueFilter`, so the table narrows with it — one notion of "looking at
Erik" rather than two that can disagree. On `/leads` it scopes the cards only:
a Lead's `followedUpBy` is who should chase it, while the card counts who
*added* it, so filtering the grid by that name would answer a different question.

Events with no colleague are shown as "Utan ansvarig" rather than dropped, and
the row is deliberately not selectable — it names nobody to filter to. This is
not cosmetic: roughly a tenth of the log has no colleague (12 of 86 this week),
so omitting it would leave a breakdown that visibly fails to add up to the total
printed beside it. Verified against live data — week 35/28/12/11 = 86 = the
total, today 16/10/7/4 = 37 = the total.

The week card's target stays the team's even when narrowed to one person.
Dividing it by three would invent a per-person target nobody agreed to.

**Why a route rather than the snapshot.** `/leads` and `/prospects` are client
components fed entirely by the store, which is built from `loadSnapshot()` in the
root layout. Folding goals into that snapshot would read them on every page load
— including the many routes with no card — and ship them to the client tree
regardless. `app/api/goals/weekly/route.ts` lets the two pages that want this ask
for it, behind the same session check as the other goal routes. It calls the new
`loadWeeklyProgress()`, a narrow read of the `weekly` goals plus
`countEventsSince(weekStart(now))` — deliberately not `loadGoals()`, which also
pulls metrics, personal goals and the derived revenue/customers/pipeline totals a
card has no use for. It also deliberately does **not** call
`archiveFinishedWeeks()`: that is a write, and the 60s poll keeping these cards
fresh would otherwise fire it from every open tab several times a minute. The
wallpaper and `/goals` already trigger the archive.

The card polls every 60s (picking up outreach logged in another tab, and rolling
the week over without a reload) and caches at module level so moving between the
two pages doesn't refetch. A failed fetch renders nothing — this is ambient
encouragement, not data being worked from, and must never take a page down.
Verified against the live database: `prospect_contacted` 52/30 (green, bar
clamped at 100%), `lead_added` 13/50, `deal_won` correctly absent.

**Layout (polished 2026-09-02).** The header had grown three stacked full-width
control rows — chips, then search + filter, then the pager — with the count cards
stranded in ~600px of dead space to the right of a short search field, attached
to neither the controls nor the table. They are now one cluster: everything that
narrows the table on the left (search + filter panel above, preset chips below),
the counts anchored to the cluster's right edge, where they sit at the boundary
between the controls and the rows they describe. The per-colleague chips were
**removed** in the same pass — the cards' breakdown filters by person *and* shows
each person's number, so keeping both was duplication that could also visibly
disagree.

**Quick filters (`components/crm/QuickFilters.tsx`)** sit in that cluster on
`/prospects`: "Kontaktade denna vecka", "Behöver uppföljning", "Heta". They are presets over the
same rows the panel narrows, not a second system — a chip and the panel compose.
"Behöver uppföljning" means due today or earlier and deliberately excludes rows
with no follow-up date, which are unscheduled rather than overdue. "Kontaktade
denna vecka" uses the same Monday-00:00-local boundary as
`board-metrics.weekStart`, reimplemented in the page because that module is
`server-only`, so the chip and the count cards beside it agree on which days
count.

**There is no "Mina" chip**, though it is the obvious one to want. The app has a
single shared password and no accounts, so nothing knows who is looking; a
"mine" that silently meant one hardcoded colleague would be worse than its
absence. Filtering by person is explicit instead. If per-user identity ever
lands, this is the first thing that should use it.
### Contacted-prospect export (lib/export-prospects.ts)
Added 2026-09-01. A "Exportera kontaktade"/"Export contacted" button on
`/prospects` downloads every already-approached company as CSV, to hand to an AI
building a prospecting list so it doesn't return companies the team has already
called.

**What counts as contacted** is stage rank at or past `Contacted` — the same bar
`crossedInto(from, to, 'Contacted')` uses in `lib/db/events.ts`, deliberately
shared so the export and the weekly outreach counter cannot drift apart on what
the word means. Only `New` and `Ongoing` fall below it. This reads the *stage*,
not the event log, and the distinction is load-bearing: the log answers "how much
outreach happened last week", a fact about a period, while the export answers
"have we ever touched this company", a fact about the company. A prospect
contacted before `crm_events` existed has no event but is still contacted.

**`Lost` is included, on purpose.** It clears the bar on rank alone (it sits after
`Won` in `STAGES`), which is the opposite of what `events.ts` needs — there
`crossedInto` excludes `Lost` so marking a deal lost cannot read as progress.
Here a lost company is emphatically one already approached, and omitting it is
precisely how a dedup list hands back somebody the team already burned. The stage
ships as a column so a reader can still tell a dead company from a live one.

**The export ignores the page's filters and search**, building from `allRows`
rather than `filteredRows`. Exporting whatever happens to be on screen would
silently omit contacted companies and reintroduce the duplicates the file exists
to prevent.

Format details that are deliberate rather than incidental: every field is quoted
unconditionally (Swedish company names and free-text notes carry commas, quotes,
semicolons and newlines; a conditional quoter is one unusual name away from a
shifted column), embedded quotes are doubled per RFC 4180, whitespace inside a
field is collapsed so a multi-line note can't visually break its record for a
model reading the file as text, `lastContacted` stays raw `YYYY-MM-DD` rather
than the user's display format because the file is machine input, line endings
are CRLF, and a UTF-8 BOM is prepended or Excel mangles å/ä/ö. Rows sort newest
contact first, so a truncated list loses the oldest touches rather than the end
of the alphabet. Verified by round-tripping a CSV containing commas, embedded
quotes, newlines and Swedish characters back through a parser with column counts
intact.

### Shared Config (lib/stage-config.ts)
- `STAGES: Stage[]` — canonical ordered list of the 9 pipeline stages
- `stageColors: Record<Stage, string>` — Tailwind badge classes for all 9 pipeline stages. **Retinted 2026-09-01 so the nine tags are actually tellable apart.** They had all been the same flat 10%-tint chip, which made the middle of the funnel one pastel wash — `Contacted` (sky-400) against `Ongoing` (blue-400), and `Proposal Sent` (amber-400) against `Negotiation` (yellow-400), were near-identical at a glance. Now: every tag carries a visible border and text a full step off the fill; `Ongoing` moved blue→slate and `Negotiation` yellow→fuchsia to open the two collapsed pairs; and the terminal states break the pattern deliberately — `Won` is the only solid fill, `Lost` the only struck-through — so a closed deal is findable in a dense table without reading labels. Colors now come from per-theme `--stage-*` tokens in `globals.css` (fill/text/edge per stage, mapped through `@theme inline`) rather than Tailwind's stock palette: a `sky-400` chip that reads on the dark `#242220` surface washes out on the light theme's warm `#E8E3DB`. Tokens also sidestep Tailwind 4's `dark:` variant, which keys off `prefers-color-scheme` and would fight this app's `[data-theme]` toggle
- `stageDot: Record<Stage, string>` — fixed hex marker rendered inside each stage tag, same rationale as `priorityDot`. Added 2026-09-01 so stage survives skimming and doesn't rest on hue alone (color-blind readers, grayscale printing). Applied inline via `style={{ background: stageDot[s] }}` by `CRMTable` (both the desktop cell and the mobile card) and the `prospects/page` board column headers
- `priorityDot: Record<Priority, string>` — fixed hex colors (not Tailwind theme classes) for all 4 priority levels: critical `#E05252`, high `#E09040`, medium `#D4943C`, low `#4CAF72`. Deliberately not theme tokens — `bg-accent`/`bg-muted` shift hue between light/dark by design, but a priority indicator needs to read as the same color regardless of theme. Consumers apply it via inline `style={{ background: priorityDot[p] }}`, not className
- `priorityRamp: Record<Priority, { from: string; to: string }>` — two-stop gradients for the priority `ColorSlider`. Kept **separate** from `priorityDot` rather than replacing it: a 6px dot reads best flat and saturated, while a large fill needs a gradient. `priorityDot` now has ten consumers, including the new `leads/page` cards and drawer
- Single source of truth; imported by `CRMTable`, `prospects/page`, `leads/page`, `pipeline/page`, `AddProspectModal` (stage pills), `FilterBar`, `LeadCard`, and `dashboard/page` — previously `FilterBar`, `LeadCard`, and the dashboard each had their own duplicate (and inconsistent) local copy; consolidated into this one. `prospects/page` and `FilterBar` still carried their own hardcoded `Stage[]` list despite the import existing for other exports — fixed 2026-09-01 alongside the stage rename below, so `STAGES` can't drift out from under them again. `PipelineBoard.tsx` keeps its own local `STAGES`/`stageBorder` (dnd-kit needs the array in scope for `SortableContext`/column rendering, and `stageBorder` has no equivalent in `stage-config.ts`) — not deduped, out of scope for this pass. `stageBorder`'s six tinted entries were repointed at the shared `--stage-*-edge` tokens on 2026-09-01, though: it had hardcoded the pre-retint hues, so the column edge would otherwise have stayed blue/yellow while the tag above it went slate/fuchsia

**Renamed 2026-09-01: `New`/`Researched` collapsed into `New`/`Ongoing`
("Undersökt"/"Pågående").** The board was carrying three early-pipeline
columns (New, Researched, Contacted) where the team only ever used two in
practice. `New` keeps its enum value but now displays as "Undersökt" (was
"Ny"); `Researched` is retired from the `Stage` TS union and the `STAGES`
array — existing `Researched` rows migrate to `New` — and a new value,
`Ongoing` ("Pågående"), takes the vacated second slot, starting empty.
`Researched` stays defined on the Postgres `crm_stage` enum forever (enum
values can't be dropped) but the app never writes it again.
`20260901120000_stage_ongoing.sql` adds the enum value (its own migration —
see the enum-transaction rule below); `20260901120100_stage_ongoing_backfill.sql`
merges `Researched` rows into `New` and renumbers `sort_order` across the
merged column so nothing collides. **Written but not yet pushed** — run
`npm run db:push` (or `-- --dry-run` first) to apply.

### Display Settings and localization (`lib/settings.ts` + `lib/i18n/` + hooks)

Read-time formatting only — **never** what is stored. Amounts stay plain numbers
and dates stay ISO strings in Postgres. Every stored `deal_value` is denominated
in `BASE_CURRENCY` (**SEK**); switching currency converts for display, so 48000
reads as `48 000 kr` under SEK and `5 tn US$` under USD. Rates live in the
static `FX_RATES` table in `lib/settings.ts` — hand-maintained, no network call
on render — and are dated in a comment there.

| File | Role |
|---|---|
| `lib/settings.ts` | `DEFAULT_SETTINGS`, the `CURRENCIES` / `LOCALES` / `DATE_FORMATS` catalogs, and the formatters: `formatCurrency`, `formatDate`, `formatDateTime`, `formatNumber`, `currencySymbol` |
| `lib/hooks/useFormat.ts` | `useFormat()` — the formatters bound to the current settings. Every amount and date on screen goes through this |
| `lib/i18n/translations.ts` | Shape-checked Swedish and English dictionaries, including app-owned copy plus presentation labels for stages and priorities |
| `lib/hooks/useTranslations.ts` | `useTranslations()` — returns the active interface language and dictionary from the settings store |

- Currencies: **SEK, EUR, USD, GBP** (deliberately trimmed from a longer list)
- Interface languages: **Swedish** (default) and **English**. Interface language
  is independent of the eight regional formats spanning en/de/fr/es/nl/sv/ja
- Swedish is also the default regional format (`sv-SE`). Existing currency
  choices are preserved when pre-localization settings migrate; currency remains
  a separate user choice from interface language
- `convertFromBase` / `convertToBase` bracket the FX boundary. Display goes
  through `formatCurrency`, which converts on the way out; the one money input
  (`AddProspectModal`'s deal value) converts on the way in via `fmt.toBase`,
  because the field is prefixed with the *display* currency's symbol. Any new
  money input has to do the same, or it writes a figure that is off by the FX rate
- Compaction is applied to the **converted** amount, not the stored one: the
  `>= 1000` threshold and the 1-decimal rounding both see the display figure
- Database stages and priorities keep their canonical English enum values. Only
  their display labels are localized, so filtering, drag/drop and persistence
  contracts do not change. Strategy headlines are user-written text and are
  never translated — they read back exactly as typed, in any interface language
- `currencySymbol()` reads the symbol out of `Intl.formatToParts` rather than the
  `CURRENCIES` table, because the right symbol depends on locale *and* currency —
  SEK is `kr` under sv-SE but `SEK` under en-US. A hardcoded table would let an
  input prefix disagree with the formatted value beside it
- Every `Intl` call is wrapped: an unsupported locale/currency pair falls back to
  the raw number rather than throwing, so a bad preference can't blank a deal value
- `sounds` (default on) gates the interface chimes. Only the task check-off uses
  it today; anything audible added later should read the same flag rather than
  growing a second preference
- `AddProspectModal`'s deal-value prefix is text, not a `DollarSign` icon, and the
  input's left padding comes from a length lookup (`pl-11`/`pl-14`/`pl-[4.5rem]`) —
  Tailwind needs whole class names at build time, so it can't be interpolated

**There are now zero raw `toLocaleString()` calls and zero hardcoded `$` in the
app.** Three `DollarSign` icons were removed along the way; left in place they
would have printed `$` next to `517 000 kr`.

### Pipeline board interaction (components/crm/PipelineBoard.tsx)

Three separate mechanisms, deliberately kept apart because they answer different
gestures:

- **`useBoardPan`** (`lib/hooks/useBoardPan.ts`) — panning with no card in
  hand. A vertical wheel over the board becomes horizontal travel, and the
  background can be grabbed and thrown sideways. Extracted from a
  pipeline-only inline hook into a shared one: `CRMTable`'s horizontal scroll
  (the prospects table) and the prospects page's board view now use it too,
  not just the pipeline kanban. Two independent, separately-configurable exclusion
  selectors, because click-drag panning and wheel-to-horizontal answer
  different problems:
  - `panExcludeSelector` — presses that shouldn't start a drag-pan because
    they belong to a control instead (a card, a button, a table row/header).
    `CRMTable` passes `'tr, th'` so panning never fights a row click or a
    header sort click.
  - `wheelExcludeSelector` — targets the wheel conversion itself should skip,
    left alone by default. The pipeline board passes
    `'[aria-roledescription="sortable"]'` (what dnd-kit tags every `LeadCard`
    with) so a normal two-finger scroll *over a card* still scrolls the page
    instead of yanking the whole board sideways — only empty column space and
    the gaps between columns convert to a pan. Without this the "genius
    scrolling" from the pipeline board felt like it hijacked scrolling
    anywhere on the page, when the actual bug was card content inside the
    board intercepting it; the listeners were always scoped to the board
    element only and never reached the sidebar or rest of the page.
  - The wheel handler only calls `preventDefault()` when the board actually
    has somewhere left to go, so at either end the page scrolls normally
    instead of the board swallowing the event. Shift-wheel and ctrl-wheel
    (zoom) are left to the browser, as is a real horizontal trackpad gesture —
    that one already worked through `overflow-x: auto`
- **`useEdgeAutoScroll`** — scrolling *while* a card is being dragged. Pointer
  position is tracked continuously rather than only once a drag starts: a drag
  can begin and then hold still at an edge, and a listener attached on
  activation would never learn where the pointer is. dnd-kit's own `autoScroll`
  is left enabled underneath as a floor — both read the same pointer and scroll
  the same container in the same direction, so they add rather than fight
- **`.board-scroll`** (globals.css) — the one place a scrollbar is wayfinding
  rather than chrome. 10px with a visible track and an accent hover, against the
  4px hairline everywhere else

`onDragCancel` is wired. Without it, cancelling a drag with Escape left
`activeId` set forever: the column stayed highlighted, and once panning existed
the board also stayed permanently un-pannable. This predated the panning work
and was only visible as a stuck highlight.

**Reordering within a column now persists.** `Opportunity.order` (`sort_order`
in Postgres, added by `20260829120000_opportunity_sort_order.sql`) is the
missing piece that used to make a same-column drag snap back — `dnd-kit`'s
`SortableContext` previewed the reorder during the drag, but nothing recorded
a position, so the render right after `onDragEnd` fell back to stage-filter
order and the card visibly returned to where it started. `getCardsByStage` now
sorts by `order`, and `handleDragEnd` computes a `targetIndex` from the card
dropped on (or `undefined`, meaning "append", when dropped on empty column
space) and calls the store's `moveOpportunityCard(cardId, newStage,
targetIndex)` — which resequences the destination column densely, the same
`splice`-and-reindex approach `moveStrategyCard` already used for strategy
cards. Replaces the old `moveOpportunityStage`, which only ever changed stage
and never touched position. `addOpportunity` and `addToPipeline` both append
new cards to the end of their destination stage rather than leaving `order`
undefined or arbitrary.

**Empty column slots open a picker of off-board prospects, not the "add
prospect" modal.** A lightly-tinted, empty card silhouette (`bg-white/[0.04]`,
dotted border) rather than a "Tomt"/"Empty" label — the tint alone signals a
card belongs there, and clicking it opens the same off-board-prospects list as
the top-right "Add Prospects" button, scoped to drop the pick directly into that
column's stage (`addToPipeline(id, stage)`) rather than always landing in
"New". The picker button sits at `z-50`, above the click-outside overlay's
`z-30`, so a second press on it reliably toggles the picker closed — with no
explicit stacking the overlay could end up front of the button and swallow
the second click.

**Fixed 2026-08-31: a drag would silently reorder within its starting column
instead of moving stage, and the move never persisted.** Both `PipelineBoard`
and `StrategyBoard` used dnd-kit's `closestCorners` for `collisionDetection`.
Every card inside a `SortableContext` is its own collision candidate, not just
the column — once a column held a couple dozen cards (Kontaktad, in practice),
that column's sheer number of stacked rects out-scored every other column's
corners for corner-distance, no matter where the pointer actually was. `over`
locked onto a card in the crowded column at the first frame of the drag and
never updated again for the rest of it — confirmed directly: dnd-kit's own
`onDragMove` event showed the pointer delta tracking correctly move by move,
while `over` stayed pinned to the same card id the whole time. A card dragged
toward Varm or Möte bokat would drop back into Kontaktad's own order instead.
Fix: switched `collisionDetection` to `pointerWithin`, which hit-tests the
pointer's real position instead of scoring corner distances. Verified live —
a card dragged to a distant column now lands there immediately and survives a
reload. (A stable-identity fix to the `useSensor(MouseSensor, …)` options
objects landed in the same pass — real, but not what was causing this; kept
because passing a fresh object every render still defeats `useSensors`'
memoization for no reason.)

### Tasks (components/crm/TaskBoard.tsx, app/tasks/)

**The board is a shared component, not page-local.** `TaskBoard.tsx` holds the
column bucketing, `TaskItem`, the inline `TaskEditor`, `ArchivedRow` and the
archive drawer; both `app/tasks/page.tsx` (all tasks) and
`app/tasks/[colleagueId]/ColleagueTasksView.tsx` (one colleague's) render
`<TaskBoard tasks={...} />` off their own filtered list. `taskCounts()` is
exported alongside it for the header's active/completed summary line, since
both pages need that count computed the same way.

**Per-colleague views (`/tasks/[colleagueId]`).** A `ColleaguePicker` dropdown
in the header (next to "Add Task" on both `/tasks` and the colleague pages)
switches between the full board and `erik`/`abdi`/`hai`'s own, filtered by
`task.assignee`. `app/tasks/[colleagueId]/page.tsx` is a server component that
validates the segment against `COLLEAGUE_IDS` and 404s on an unknown one —
same convention as `/goals/display/[colleague]` — then hands off to the client
`ColleagueTasksView.tsx`, which does the actual filtering: tasks live in the
client-side Zustand store, not a server read, so the filtering itself can't
happen where the validation does. Unassigned tasks (`assignee` undefined) only
ever surface in the "All" view — there's no colleague bucket for them.

**The card leads with who and shows the whole what.** The assignee renders as
a named chip (avatar + name) at the top of the card, not a small initial
buried in the metadata row — the thing a glance needs first. The description
used to be `line-clamp`-truncated (1–2 lines) and is now shown in full
(`whitespace-pre-line`, no clamp) since cutting it off was hiding the point of
the task. `critical`-priority tasks get a 3px accent-colored edge marker down
the left of the card plus a solid `bg-danger-muted` badge in place of the flat
6px priority dot other priorities still use — enough to read as urgent at a
glance without adding a second checkbox-competing element.

**Columns are derived, not stored.** `onPace` is everything open and not past
due — today's work and what is ahead of it — so the middle column only ever
holds what actually slipped. Editing a due date re-buckets the task for free.

**Check-off** runs in three beats: a 1.5px line sweeps the title via `scaleX`
on a `transform-origin: left` overlay (320ms), the chime plays, and only then
does the store move the task, at which point a shared `layoutId` inside a
`LayoutGroup` flies the row across to Completed (700ms). The list container
**must not** carry `overflow-hidden` or the row is sliced off at the column edge
the moment it leaves; `z-index: 30` while in flight keeps it over the borders.

The completed *resting* look (`opacity-40`, `line-through`) is plain CSS, never
a Framer target. Animated values only exist once the animation loop has ticked,
so a row that mounts straight into Completed — reload, reduced motion, a
backgrounded tab — rendered at full opacity with no strike, reading as
un-completed. Framer owns the transition; CSS owns the state.

**Archiving is the only way off the board.** Delete exists but is reachable only
from inside the archive drawer, behind a `ConfirmDialog` — two deliberate steps.
Archived tasks stay in the store and still resolve by id, so anything
referencing a task keeps working; that is the whole reason to prefer archive
over delete. `Rensa` on the Completed header archives the column in one go.

`lib/sound.ts` synthesises the chime rather than shipping an audio file — no
binary in the repo, no fetch, no decode before it can sound. Two sine partials,
C6 (1046.5 Hz) plus G6 entering 35ms later and decaying faster, which is what
makes a bell read bright at the strike and warm as it rings out. The
`AudioContext` is built lazily inside the click handler, never at import, so
autoplay policy never blocks it. Gated on the `sounds` setting.

`DateStepper` (in `FormFields`) is used by both the inline editor and the add
modal. Its day arithmetic runs on the date parts **in UTC** — a local-midnight
`Date` sent back through `toISOString()` lands on the previous day anywhere east
of UTC, so a nudge in Stockholm would silently subtract a day. Verified stepping
through the 29 March 2026 DST boundary in `Europe/Stockholm`.

**Add Task is a modal (`AddTaskModal.tsx`), not an inline show/hide form.** The
old form had no due-date control at all (silently hardcoded to +7 days) and
plain pill buttons for priority. The modal has title, description, priority via
the shared `ColorSlider`, an actual due-date input, and an assignee picker —
same material and field layout as `AddProspectModal`/`AddCompanyModal`. The inline
pencil-editor kept its existing row-morphs-in-place interaction (not converted
to a modal) but picked up the same `ColorSlider` for priority and the same
`AssigneePicker` for assignee, so both entry points now agree on controls.

**Assignment (`lib/colleagues.ts`).** The app has no real accounts yet (see
Auth under What does NOT exist), so `Task.assignee?: ColleagueId` is a fixed
three-person roster — `'erik' | 'abdi' | 'hai'` — not a foreign key to a users
table. Each colleague has a name and a fixed avatar hex (same reasoning as
`priorityDot`: an avatar has to read as the same color in both themes).
`AssigneePicker` (in `FormFields`) renders the roster as pills with an explicit
"unassigned" option, shared by `AddTaskModal` and the inline editor; `TaskItem`
shows a small initial-avatar next to the due date when a task has an assignee.
Persisted via `supabase/migrations/20260824120000_task_assignee.sql` (new
`crm_colleague` enum, nullable `tasks.assignee` column) — applied to
`wmnobqhypkocirfybqsj`, verified directly against `information_schema.columns`.

### Error handling (lib/db/retry.ts + app/global-error.tsx)

Two layers, because the database read happens in the root layout and a failure
there has nothing above it to catch it:

| Layer | Handles |
|---|---|
| `lib/db/retry.ts` | Transient faults on writes (`app/actions/crm.ts`, via PostgREST) **and, since 2026-09-01, on reads again** — `withDbErrors` in `queries.ts` now wraps every read in `withRetry(label, run, isTransientRead)`. Bounded by *elapsed time*, not attempt count: 2.5s for auth-timing faults, waiting 250ms → 500ms → 1s → then a flat 750ms. See "Read retries came back" below |
| `app/global-error.tsx` | Everything a write's retry can't, plus any read failure — renders a themed screen with a working retry button |

**Read retries came back (2026-09-01).** The bug was not the predicate — it was
that reads never consulted one. `withRetry` was wired into the write path only;
`isTransientRead` was exported and imported by nobody; `withDbErrors` relabelled
the failure and rethrew. One dropped connection to the pooler was a full error
screen with no second attempt. It now wraps every read in
`withRetry(label, run, isTransientRead)`.

`TRANSIENT_READ` was widened in the same change, but measurement demoted that
half from "the fix" to a backstop. Against a TCP proxy killing the socket
mid-query, a reset surfaces as `read ECONNRESET` — a pattern that was in the set
all along — and the read recovers in ~430ms. A *graceful* close never reaches
this predicate at all: postgres.js re-queues the query on a fresh connection
itself (~173ms, no retry logged). `CONNECTION_CLOSED` and `CONNECT_TIMEOUT` were
added for the cases the driver does surface — an exhausted `connect_timeout`, or
a close it cannot re-queue around — and neither fired in those measurements.

`CONNECTION_ENDED` and `CONNECTION_DESTROYED` are deliberately **not** in the
set: they mean the pool object itself is gone rather than that a connection
dropped, so retrying against it cannot reconnect — better to fail at once than
to spend the whole budget first. `withDbErrors` also now takes a `label`
(`'snapshot read'`, `'goals read'`, `'snapshot version read'`, `'goals version
read'`) so a retried fault says which read it came from. Non-transient faults —
a wrong connection string, an un-migrated database — are unchanged: they still
throw on the first attempt, still with `unwrap`'s diagnostic shape rather than a
bare "connection error".

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

**Its copy no longer names a cause (2026-09-02).** It used to read "check that
the database is reachable and the credentials in `.env.local` are still valid".
Wrong on two counts. This boundary catches *any* root-layout throw — there is no
`error.tsx` anywhere in `app/` — so a database cause is one possibility among
many, and it pointed at the database on two separate days when the database was
healthy. And missing credentials cannot reach this screen at all: `loadSnapshot()`
returns demo data when they are absent, so the single condition the copy
described was the one condition that never produces it. The `helpBeforeEnv` /
`helpAfterEnv` pair collapsed into one `help` string pointing at the two things
that do identify the fault — the digest on screen and the full message in the
server log.

Verified 2026-08-21 by booting with a deliberately invalid `SUPABASE_SECRET_KEY`
as an env override (`.env.local` untouched): the page rendered with its digest,
and "Try again" re-ran the render. That also exercised the retry's fast path —
`Invalid API key` is non-transient, so it failed on the first attempt rather than
spending the whole budget on a fault that was never going to clear.

### Connection pool + the 2026-09-02 lockout (lib/db/pg.ts)

`getDb()` opens one `postgres.js` pool per process, cached on `globalThis` so a
dev-server module reload cannot leak a second one. What that cache does *not*
survive is a process restart — which is also the only way a running server picks
up a change to the options below. Editing this file is not enough; restart.

**The lockout.** On 2026-09-02 every read failed with `(EMAXCONNSESSION) max
clients reached in session mode - max clients are limited to pool_size: 15`, and
`/prospects` showed the `global-error.tsx` screen. That screen's copy told the
reader to check the database and `.env.local`; both were fine. It has since been
rewritten — see Error handling. The read retry above correctly did *not* fire — `EMAXCONNSESSION`
is not transient, it persisted across probes minutes apart, and retrying would
only have delayed the same screen.

The 15 is a ceiling on the session pooler **per project**, shared by every
process that opens `SUPABASE_DB_URL` — not per process.

**Root cause: no `idle_timeout`.** postgres.js defaults it to `null`, meaning
never close an idle connection. The only thing that ever reclaimed one was
`max_lifetime`, itself a randomised 30–60 minutes
(`node_modules/postgres/src/index.js:515`). A single page load therefore pinned
up to `max` project-wide slots for up to an hour after the read had finished.
Caught in the act: twelve idle Supavisor backends, two still holding slots 26
minutes after their last query, each fingerprinted by that query as this app —
`select * from strategy_cards …`, the `max(updated_at)` change-stamp ×5, and so
on. Nothing foreign was on the database; the app had locked itself out.

| Setting | Was | Now | Why |
|---|---|---|---|
| `max` | 5 | 2 | 5 divides into the project's 15 only three ways. 2 fits roughly seven processes. Costs latency — `loadSnapshot()`'s eight parallel reads queue four deep instead of two |
| `idle_timeout` | unset (never close) | 20s | The setting whose absence caused the lockout. 20 and not lower because `SnapshotSync` polls every 12s: one connection stays legitimately warm across polls, the second is released between page loads |

**Do not reach for the transaction pooler (port 6543) to escape the ceiling.**
Measured against postgres.js 3.4.9 on 2026-09-02, and deterministic across
repeated runs: a pooled connection serves about two queries and then stalls on
reuse — silently, no error, no timeout, the promise simply never settles.
Roughly 2×`max` queries succeed and the rest hang forever.

| pool `max` | parallel queries | result |
|---|---|---|
| 1 | 8 | hangs after 2 |
| 3 | 8 | hangs after 7 |
| 5 | 8 | passes |
| 5 | 12 | hangs after 11 |
| 5 | 20 | hangs after 11 |
| 10 | 20 | passes |

Raising `max` only moves the cliff — a long-running server reuses connections
indefinitely. `loadSnapshot()` fires eight parallel reads, one below the edge at
`max: 5`. Switching would trade a loud error screen for a hung tab that no
boundary can catch and no retry can reach. Transaction mode needs a different
driver (node-postgres), not a different number.

**Verified live 2026-09-02**, once the pooler freed up:

- `loadSnapshot()`'s eight parallel reads over a 2-connection pool completed in
  **124ms**. No hang — the queueing that breaks in transaction mode is fine in
  session mode, where a backend is pinned to the session for its lifetime.
- Three parallel queries opened exactly **2** sockets, and both closed between
  18s and 24s of idling. `idle_timeout` releases the client slot as intended.

**Do not verify this with `pg_stat_activity`.** The obvious check — watch the
backend count fall after the pool goes quiet — reports a false negative, and did
on the first attempt here. Those rows are *Supavisor→Postgres* backends, which
Supavisor pools and keeps warm independently of client sessions; the
`EMAXCONNSESSION` ceiling counts *client→Supavisor* connections, which are a
different thing entirely. A backend outliving your disconnect is normal and
proves nothing. Measure the client socket instead
(`Get-NetTCPConnection -RemotePort 5432 -OwningProcess <pid>`), which is what
the numbers above are.

The diagnosis in this section was read through the Supabase Management API,
which runs SQL over its own connection and needs no pooler slot — the way back
in when the pooler is full.

### Auth gate (lib/auth/ + proxy.ts + app/login/)

**One shared password, no accounts.** Anyone holding it gets full read/write on
every record, so it is a workspace credential rather than a personal one. This
authenticates but does not authorize — there is no identity to scope data
against (see What does NOT exist).

| File | Role |
|---|---|
| `lib/auth/session.ts` | Signs/verifies the cookie, compares the password. `SESSION_COOKIE`, `createSession()`, `verifySession()`, `verifyPassword()`, `sessionCookieOptions`, `generateSecret()` |
| `lib/auth/guard.ts` | `isAuthenticated()` (React `cache`d), `requireSession()` for pages, `requireAuth()` for Server Actions |
| `proxy.ts` | Route-level redirect gate — Next 16's renamed `middleware.ts` |
| `app/actions/auth.ts` | `login` (a `useActionState` form handler) and `logout` |
| `app/login/page.tsx` + `components/auth/LoginForm.tsx` | The gate itself |

**The cookie is a signed timestamp, not an encrypted token.** Value is
`<expiry>.<hmac>`, HMAC-SHA256 over the expiry with `AUTH_SECRET`. There is no
identity to hide, so signing is the whole requirement — the payload is
readable, it just cannot be forged. Nothing is stored server-side, so there is
no session table and nothing to clean up; the tradeoff is that a single session
cannot be revoked. Rotating `AUTH_SECRET` invalidates every session at once,
which is the right blunt instrument for a shared password. Seven-day expiry.

**`node:crypto`, not `jose`.** Proxy runs on the Node.js runtime in Next 16, so
the built-in works everywhere this runs. `jose` is present only as a transitive
dependency of `@supabase/supabase-js` and could vanish on any lockfile update.

**Both string comparisons are constant-time** (`timingSafeEqual`), including
the length-mismatch path — returning early on a length difference would leak
length through timing.

**The password is compared directly, not hashed.** It is a single secret in the
environment, not a row in a users table: there is no store to breach, and
hashing would only protect the env file from itself. Hash it the moment this
becomes per-user.

**Two layers, deliberately.** `proxy.ts` is an *optimistic* check — it verifies
the cookie signature and does no I/O, because Proxy runs on every request
including prefetches. The real enforcement is `requireAuth()` inside the
actions, because Server Actions are reachable by direct POST and a request that
never renders a page never passes through a page guard.

**`requireAuth()` sits at the two choke points in `app/actions/crm.ts`, not in
all 21 bodies** — inside `run()` (everything that touches the database) and
`guardedOk()` (the early returns that never reach `run()`). A 22nd action
cannot be added without a session check unless it bypasses both. Both early-out
paths needed it: the 21 `skipUnconfigured()` returns would have been a real hole
on a credential-less preview deploy, and the 8
`Object.keys(payload).length === 0` returns answered `ok: true` to an
unauthenticated probe.

`requireAuth()` throws rather than redirecting — `redirect()` inside an action
would tell the client to navigate while the action itself had already committed
to running. `requireSession()` is the redirecting variant, for pages.

**The root layout gates `loadSnapshot()` on the session.** `app/layout.tsx`
reads `isAuthenticated()` and passes `null` instead of a snapshot when logged
out, rendering `children` bare instead of `AppShell`. Two reasons: an
unauthenticated request must not reach the database, and `AppShell` would
otherwise serialize the entire working set into the login page's HTML. This is
also why the gate is not a route group — a layout cannot read the pathname on
the server (layouts do not re-render on navigation) but it *can* read cookies,
so one root layout serves both states without moving all ten route folders.

**`LoginForm` carries its own Swedish copy** rather than using
`useTranslations()`. The dictionary is reached through the client store, which
is populated from the server snapshot in `AppShell` — the very thing the login
page renders outside of. Swedish matches the `lang="sv"` the root layout sets.

Rate limiting is a per-process in-memory counter (10 attempts / 15 min, one
global bucket). A shared password has no account to lock, and keying on a
client-settable forwarded IP would let an attacker rotate freely. It frustrates
a script pointed at one box; it is not a distributed defense, and it resets on
deploy. Move to a shared store if this ever runs on more than one instance.

**Verified 2026-08-26** against the running dev server, same action id and
payload both ways: no session → 307 to `/login`; forged cookie → 307; valid
session → 200 and the row actually landed in Postgres (then deleted). Session
primitives pass 12/12 unit cases — forged signature, tampered payload, expired
timestamp, foreign-secret signature, wrong password, password prefix. Login
page ships zero CRM chrome or data.

### Wallpaper display links (lib/auth/display-token.ts)

The one documented way past the password gate, and it exists because Lively
Wallpaper renders a URL in a bare Chromium embed: no cookie jar worth relying
on, no way to present a login form, nothing that survives a reboot. Without
this the desktop background would be the login page.

`?k=<token>` on `/goals/display/<colleague>`, where the token is
`HMAC-SHA256(colleague, DISPLAY_SECRET)` truncated to 32 base64url chars.
Signing the colleague rather than issuing one shared random string is what
binds a link to a single board — a leaked link opens that person's wallpaper
and nothing else.

Three properties worth keeping straight:

- **Scoped to display routes by pathname.** `proxy.ts` consults the token only
  for `/goals/display/*`; every other path still requires the session cookie.
  `colleagueFromDisplayPath` accepts the colleague plus at most one sub-path,
  so `/goals/display/hai/version` opens with the same token while a deeper
  route cannot inherit access by accident.
- **Read-only in practice and by construction.** The display page renders no
  forms and calls no Server Action, and `requireAuth()` reads the session
  cookie only — a token satisfies Proxy, never an action.
- **No expiry.** Deliberate: a wallpaper that goes blank in a month is worse
  than useless. Rotate `DISPLAY_SECRET` to invalidate every link at once.

`DISPLAY_SECRET` is optional. Unset, `/goals` shows a notice instead of links
and every display URL falls through to the normal login redirect.

`proxy.ts` also exempts the `khyte-logo` prefix from the gate. A browser
fetching an `<img>` cannot carry the token that lives in the page URL's query
string, so without that the wallpaper's mark 307s to `/login` and Lively paints
a broken image. Narrowed to that one prefix rather than opening all of
`/public`, so anything else dropped in that folder still meets the gate.

Note `app/layout.tsx` branches on an `x-pathname` header that `proxy.ts` sets
(and always overwrites, so a client cannot forge it) to keep `AppShell` and the
`loadSnapshot()` call off the wallpaper — without that branch every 5-minute
refresh would pull the entire CRM working set for a board that reads three
small tables.

**Verified 2026-08-26** against the production build: no token → 307 to
`/login`; wrong token → 307; correct token → 200; **hai's token on erik's
board → 307** (binding holds); **display token on `/goals` → 307** (scope
holds); **spoofed `x-pathname: /goals/display/hai` on `/goals` → 307** (header
cannot be forged). Rendered wallpaper contains zero sidebar markup, and the
two boards differ only in the personal column.

### Derived board metrics (lib/db/events.ts + lib/db/board-metrics.ts)

The direction board's numbers are computed from the CRM rather than typed in.
One distinction runs through the whole feature, and getting it backwards is the
easy mistake:

- **Current state** — intäkt, kunder, pipeline. Recomputed from
  `opportunities` on every read, never stored. Moving a deal out of Won lowers
  revenue again, because the number describes how things stand rather than what
  once happened. Needs no log.
- **Events** — möten bokade, prospekt kontaktade, leads tillagda. Counted from
  `crm_events` within the current week. "We booked three meetings" stays true
  after all three go to Lost, so these cannot be read off current stages.

Revenue counted from events would never fall; a meeting counter read from
current stages would drop every time a deal progressed past Meeting Booked.

**Events are recorded server-side, inside the Server Action, after the write
succeeds.** Never from the client store — every CRM mutation there is
optimistic, so emitting from it would log activity that never reached the
database. `updateOpportunity` reads the prior stage before writing, because the
row about to be overwritten is the only place it exists; only stage changes pay
for that extra read.

**Transitions, not states, and only forward ones.** `eventsForStageChange`
records a threshold crossing, so dragging a card into Meeting Booked and back
out logs one event rather than two, and dragging it forward again logs a second
— that genuinely is a second booking. A jump straight from New to Meeting
Booked crosses the Contacted threshold too and records both. Won is an arrival
rather than a threshold, so re-closing from Lost counts again; `Lost` is
excluded from every crossing so marking a deal lost never looks like progress.
11 transition cases verified, including every drag-back case.

**Arrival, not only transition — a prospect can be born contacted.** Recording
only on stage *changes* missed how this team actually works: they call a company
first and enter it afterwards, filed straight into `Contacted` with the date of
the call. `createOpportunity` logged nothing at all, so a day on the phone read
as zero. Of 22 prospects added on 2026-08-31, 18 were created directly at
`Contacted` while the week's counter showed 3. `eventsForArrival` now treats a
deal created at a stage as having crossed every threshold below it, measuring
from `PIPELINE_START`, and both the create and the update path go through it so
the two cannot drift apart.

**Outreach is dated by `lastInteraction`, not by when it was typed.** Adding a
prospect you called last Tuesday credits last Tuesday's week — `occurredOn`
fills `occurred_at`, which the migration always intended for exactly this. Dates
are parsed field-by-field into local midnight rather than through
`new Date(string)`, which reads a bare date as UTC and, west of Greenwich, would
file a touch in the previous day and possibly the previous week. The stage
decides *whether* anything is recorded and the date only decides *which week* it
lands in, which is why `AddProspectModal` defaulting a blank date to today is
harmless. A stage drag stays dated now: moving a card today happened today,
whatever date the deal carries.

**`prospect_contacted` is deduped per prospect per day.** It is the one kind two
gestures both report — the stage the prospect is filed under, and "senaste
kontakt" — so without this, doing both for one call counts twice. The check
reads before appending, which the append-only rule permits: it forbids editing
history, not declining to write the same fact twice. It also guards a batch
against itself, since two events in one array are both absent from the database
and would each otherwise pass. It **fails open** — a check that errors records
anyway, because the write it accompanies has already succeeded, and
under-counting is the failure this feature exists to prevent. No other kind opts
in: a deal can genuinely reach Meeting Booked and Won on the same day.

**Backfill: `npm run backfill:events`.** Reconstructs events for prospects
entered before creation was recorded, applying the same rule and the same
per-day dedupe, dated by `last_interaction` falling back to `created_at`. Dry
run by default, `-- --apply` writes. It duplicates the stage list from
`lib/stage-config.ts` because a plain `.mjs` cannot import the TypeScript
module; an unrecognised stage ranks -1 and so records nothing, erring toward
never inventing outreach.

**Verified 2026-09-01** against the live database: the backfill wrote 18
`prospect_contacted` events — 16 into the current week, 2 into the week of
2026-08-17, none into the already-frozen week of 2026-08-24 — taking the current
week from 3 to 19, and a second run wrote nothing.

`crm_events` is append-only and its `subject_id` is deliberately **not** a
foreign key: an event is a historical fact, and deleting the lead or
opportunity it refers to must not delete the fact that it happened, or a past
week's counts would change retroactively.

**Weekly non-negotiables live on the `goals` table**, in a `weekly` section
with `metric_kind` and `metric_target` columns — a non-negotiable *is* a goal,
differing only in that its number is counted rather than typed. A row with a
null `metric_kind` is an ordinary hand-tracked goal, which is every row that
predates this.

**Finished weeks archive on read, not on a schedule.** There is no cron here,
and a wallpaper reloading all day is a more dependable trigger: the first load
after Monday midnight closes the week that just ended, and catching up several
weeks at once is the same loop, so a laptop shut for a fortnight still archives
correctly. The counts could be recomputed from `crm_events` forever, but the
target could not — "12 of 15" needs the 15 that was in force that week, and
that lives on a row the operator may change next Monday — so `weekly_snapshots`
freezes both. Idempotent by a unique index on `week_start`; an archive failure
is caught and logged rather than thrown, since a missing history row is worth
far less than the board it would otherwise take down.

**Verified 2026-08-28** against the live database: a backdated event produced
exactly one snapshot, four further reads produced no duplicates, and the
current week's count correctly excluded the archived one. Driving the same
read-write-log sequence the action uses, New → Meeting Booked logged both
thresholds, the backward move logged nothing, and the re-forward move logged
one more.

### Wallpaper live updates (app/goals/display/[colleague]/version/)

An edit in `/goals` used to take up to five minutes to reach a desktop. The
board now checks a version stamp every 5 seconds and reloads only when it
differs, with the unconditional 5-minute reload kept as a backstop for what a
stamp cannot see — a deploy, a persistently failing check, a slept machine.

**This is deliberately not Supabase Realtime**, despite `realtime-js` already
being installed. Realtime enforces RLS, and every policy on these tables is
scoped to `authenticated` with `auth.uid() = owner_id` while every row still
has a null owner. A browser subscribing with the publishable key connects as
`anon` and receives nothing — verified by querying as anon, which returns zero
rows rather than erroring. Making it work would mean granting `anon` SELECT on
the goals tables, and since the publishable key ships in the browser bundle
that would put the company's goals and revenue on the public internet, undoing
the gate this feature sits behind. Revisit when per-user auth lands.

The stamp is `max(updated_at)` plus a row count across the three goals tables
and `crm_events`. The count is not redundant: a delete lowers no timestamp, and
without it a removed row would go unnoticed until the slow reload. The endpoint
re-checks the display token itself rather than trusting `proxy.ts` — a Route
Handler is reachable by direct fetch — and returns only a timestamp and a
count, so a leaked stamp reveals nothing but "something changed".

### CRM live updates (app/api/snapshot/ + components/layout/SnapshotSync.tsx)

Three colleagues work in this CRM at once, and until now none of them could see
each other. The working set is read once per full page load and then lives in
the client store for the rest of the session, so a write by Abdi stayed
invisible to Erik until somebody happened to reload. This closes that.

Same shape as the wallpaper's loop above, aimed at the other half of the app.
`loadSnapshotVersion()` returns `max(updated_at)` plus a row count across the
eight working-set tables; `SnapshotSync` asks `/api/snapshot/version` every 12
seconds and pulls `/api/snapshot` only when the stamp differs from the one it
is holding. All eight tables carry a `set_updated_at` trigger — the six from
the init migration plus `strategy_columns` and `leads` from their own — so the
timestamp half is reliable across the set, and the count catches deletes, which
lower no timestamp.

**Not `location.reload()`, which is what the wallpaper does.** That board keeps
no client state; this side keeps an open drawer, a half-typed note, the current
filters, sort and page. Fresh rows are merged into the store instead and React
re-renders what actually changed.

**Not `router.refresh()` either**, which looks like the idiomatic answer and
does nothing here: it re-runs the layout and hands `CRMStoreProvider` a new
snapshot prop, but the provider builds the store in a `useState` initializer
and never rebuilds it (see State Management). The store has to be told
directly — `applyRemoteSnapshot()`.

**A merge can be refused, and a refusal is not a failure.** Two things block
it: a local write still in flight (the snapshot on the wire was read before it
landed, so applying it would visibly undo the change the user just made), and
an active pipeline drag (rebuilding the columns around the card dnd-kit is
holding is how a card lands in a column that no longer exists —
`PipelineBoard` brackets its drag with `pauseRemoteSync`/`resumeRemoteSync`).
A refused merge deliberately leaves the seen-stamp untouched so the next tick
retries the same change rather than dropping it.

The stamp is read **before** the rows in both `/api/snapshot` and the root
layout, and that ordering is load-bearing: a write landing between the two
reads must leave the stamp behind the data (one redundant merge) rather than
ahead of it (a change marked seen that never arrived).

Polling pauses on a hidden tab and checks immediately on `visibilitychange`,
so tabbing back is faster than the interval rather than slower. Failures are
silent — a 401 means the shared session expired, and replacing a working CRM
with a login form mid-edit is worse than showing slightly stale rows.

**Still not Supabase Realtime**, for the reason already recorded above and on
`loadGoalsVersion()`: it enforces RLS, every policy is scoped to
`auth.uid() = owner_id`, and every row still has a null owner. Note that when
per-user auth lands the policies will need a *workspace* shape rather than a
per-owner one — all three colleagues are meant to see the same pipeline, so
`owner_id = auth.uid()` is the wrong predicate even once accounts exist.

**Verified 2026-08-31** against the live database and dev server: unauthenticated
→ 307 to `/login`; authed → 200 with `no-store`. Touching a row moved the
timestamp half of the stamp; deleting one inside a rolled-back transaction moved
the count half (89 → 88) while the timestamp stood still, which is precisely the
gap the count exists to close. Full loop driven end to end — baseline stamp, an
out-of-band write, poll sees the change, snapshot carries the new value, and the
following idle poll correctly fetches nothing.

### Direction editor live updates (app/api/goals/version/ + components/goals/GoalsSync.tsx)

`/goals` was the last screen with no refresh loop. The wallpaper had one and the
CRM had one; the editor rendered once and froze, so a week of outreach could
land in `crm_events` without a number on the page ever moving. Third consumer of
the same stamp `loadGoalsVersion()` already produced.

**The editor also never displayed the counted numbers at all.** `loadGoals()`
had been returning `weeklyCounts` all along and `GoalsEditor` dropped it on the
floor — the weekly rows rendered a title, an event kind and a target, with no
actual. "3 av 15 möten" existed only on the wallpaper, so no amount of
refreshing would have helped. Each weekly row now shows its live count beside
the target, resolved exactly as `DisplayBoard` does (including the `progress`
fallback for a row bound to no kind, rather than silently reading 0), and turns
green on the same single signal.

**`router.refresh()` here, unlike either loop above.** The wallpaper can afford
`location.reload()` because it keeps no client state; the editor keeps a great
deal — a half-typed goal title, an open number field — and a hard reload would
eat it. A refresh merges the new RSC payload without losing unaffected `useState`
(`use-router.md` in the bundled Next docs). That works only because of how
`GoalsEditor` is arranged: the derived figures are read straight from props and
update, while the editable rows are seeded into `useState` once and are left
alone. That split is now load-bearing and documented at the top of the
component. It is equally not `SnapshotSync`'s merge-into-the-store approach —
there is no goals slice in that store to merge into, so the server round-trip is
the only way these numbers move.

Note this is **not** the `refresh()` that Next 16 exports from `next/cache`,
which is Server-Action-only and throws anywhere else. This is the client
router's method, which is unchanged.

A second route rather than reusing the wallpaper's: that one lives under a
`[colleague]` segment and answers for a named board, while the editor belongs to
no colleague and pointing it at someone's display URL would tie the page to
whichever name happened to be first in the roster. It is gated on the session
alone — there is no display-token variant, because the editor has no anonymous
surface — and re-checks `isAuthenticated()` itself rather than trusting
`proxy.ts`, a Route Handler being reachable by direct fetch. The stamp is read
**before** the rows on the page, the same load-bearing ordering as the CRM loop
above and the opposite trade to the wallpaper's display page, which reads both
together because there a redundant wake-up costs a full reload rather than a
cheap RSC round-trip. Polling pauses on a hidden tab, and a failed check leaves
the last good render up.

**Verified 2026-09-01** against the live database and dev server: unauthenticated
→ 307 to `/login`; authed → 200 with a real stamp and `no-store`; `/goals` renders
200 with the weekly readout present and `GoalsSync` mounted.

### Goals timeline (lib/goal-period.ts + app/goals/timeline/)

**`annual` and `quarter` were two hardcoded boxes with no date behind either
— "this quarter" was a name a goal was typed into, never a real deadline.**
That made the two bands impossible to sort against each other and gave neither
anywhere to put "actually, this is due March 15th". They are now one merged
`GoalSection` value, `'goal'`, carrying an optional `targetDate` (same
convention as `PersonalGoal.targetDate`) instead of a picked cadence.
`north_star`, `weekly`, `principle` and `not_now` are untouched — this only
ever collapsed the two dated-but-undated bands.

**The cadence label is derived, not stored.** `lib/goal-period.ts`'s
`goalPeriodFor(targetDate, now)` buckets a date the way it actually gets
tracked: within ~6 weeks groups by ISO week ("Vecka 35" — built on
`weekStart()` from `board-metrics.ts` rather than reimplementing Monday
alignment a second time), within the current year groups by quarter ("Q3
2026"), further out groups by bare year. No month-level bucket exists — any
date in the current calendar month is by construction within 31 days, which
the week bucket always catches first, so a month bucket could never fire. A
goal with no `targetDate` sorts into an explicit "Ingen deadline" group, always
last regardless of how its key would otherwise sort.

**`/goals/timeline` is a new read view**, grouping every `goal`-family row by
that derived period, most-imminent group first. Deliberately not editable —
`GoalsEditor` already owns writes to these rows in its one merged `Mål`
section (title/status/progress/date, replacing the old two-column
annual/quarter grid), and a second place to edit the same field would just be
a second place it could go stale. The page exists for the one thing the editor
cannot show: what's coming up soonest, since the editor lists rows in manual
`sort_order`, not by date.

**The wallpaper no longer draws the north star statement.** The section, its
editor row, and the DB rows are all untouched — this is purely "stop drawing
it", not a data change, done because the operator wants the header to read as
pure current-state (wordmark + KPIs) rather than mixing in a directional
statement. Its "quarter" column (still capped at 3, per the existing
`CAPS.quarter` design rule) now sources from the merged `goal` family sorted by
soonest `targetDate` — undated goals sort last — rather than the old fixed
`quarter` section in whatever order it was typed. Migration, in two files —
`20260830120000_goal_target_date.sql` (just the enum add, has to commit on its
own — see Known issues) and `20260830120100_goal_target_date_backfill.sql`
(the column and the backfill of existing `annual`/`quarter` rows to `goal`,
`target_date` left null since neither section ever had a date to preserve).

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

### Company enrichment fields (lib/types, AddCompanyModal.tsx, app/companies/page.tsx)

**Three new optional fields on `Company`: `revenue?: number`, `employeeCount?:
number`, `about?: string`.** Explicitly prep for a future automatic-scraping
pass — nothing scrapes anything yet, these are just plain fields a person (or
later, an integration) can fill in, with no source/confidence tracking, since
that only matters once something other than a person is writing to them.

**`revenue` follows `Opportunity.dealValue`'s exact base-currency convention**
— stored as a plain number in `BASE_CURRENCY` (SEK), converted at the
display/input boundary only, via `useFormat()`'s `fmt.toBase()`/`fmt.fromBase()`.
Getting this boundary wrong silently corrupts the figure the moment someone's
display currency isn't SEK, the same risk `dealValue` already carries — see
Display Settings and localization above. `employeeCount` is a plain integer,
no conversion. `about` is free text.

Editable in two places, both reusing existing patterns rather than inventing
new ones: `AddCompanyModal.tsx` gained a revenue field with the same
currency-prefixed-input treatment as `AddProspectModal`'s deal-value field
(`symbolPadding()` lookup and all — duplicated locally rather than shared,
same call `AddProspectModal` already made for having no third consumer yet),
an employee-count number input, and an about textarea. `CompanyDrawer` (in
`app/companies/page.tsx`) gained a companies-only click-to-edit inline section
for all three, mirroring `DetailDrawer`'s one-field-at-a-time editor state
machine exactly. An unset field renders an inviting empty state (a subtle
placeholder, not blank space) rather than being omitted — the entire reason
these fields exist is somewhere for a future scrape to land, so looking empty
by design would read as a missing feature instead of an unfilled one.

Migration: `20260830130000_company_enrichment.sql` — three nullable columns
on `public.companies`, no backfill needed since every existing row is
correctly `null` (unset) rather than needing a value.

Contacts deliberately did **not** get the same treatment — scoped to companies
only for now.

### Data Layer
Full detail in `docs/database.md`. Shape of it:

| File | Role |
|---|---|
| `supabase/migrations/20260819120000_init.sql` | 6 tables, 3 enums, indexes, `updated_at` triggers, RLS enabled with owner-scoped policies. One of those enums, `crm_strategy_column`, is dropped again by the migration below |
| `supabase/migrations/20260821120000_strategy_headlines.sql` | `strategy_columns` table; backfills the six enum lanes into per-opportunity headlines, repoints `strategy_cards.column_name` → `column_id`, drops the `crm_strategy_column` enum |
| `supabase/migrations/20260824120000_task_assignee.sql` | `crm_colleague` enum (`erik`/`abdi`/`hai`), nullable `tasks.assignee` column — plain enum, not a foreign key, same reasoning as `crm_priority` (no real accounts yet, see Tasks) |
| `supabase/migrations/20260824170000_task_archive.sql` | `tasks.archived_at`. Applied |
| `supabase/migrations/20260825120000_leads.sql` | new `public.leads` table (`id`, `owner_id`, `company_name text not null`, `priority`, `notes`, timestamps), RLS + owner policy, index on `owner_id`, `updated_at` trigger. Deliberately no FK to companies/contacts — promoting a Lead to a Prospect is what creates those records, and the Lead row is deleted at that point. Applied |
| `supabase/migrations/20260825140000_lead_contact_fields.sql` | adds `contact_name`, `connection`, `source`, `followed_up_by crm_colleague` (reuses the enum from `task_assignee` above) to `public.leads`. Applied |
| `supabase/migrations/20260826120000_opportunity_followed_up_by.sql` | adds `followed_up_by crm_colleague` to `public.opportunities`. Applied |
| `supabase/migrations/20260826140000_goals.sql`, `20260828120000_personal_goals.sql`, `20260828140000_crm_events.sql`, `20260828140100_weekly_goal_section.sql` | the direction-board schema — see Derived board metrics. Applied |
| `supabase/migrations/20260829120000_opportunity_sort_order.sql` | adds `opportunities.sort_order`, backfilled per-stage from `created_at desc` so no card visibly moved. Applied |
| `supabase/seed.sql` | the former mock data as real rows, fixed UUIDs, re-runnable |
| `supabase/config.toml` | local CLI config from `supabase init`; not a project link |
| `scripts/supabase.mjs` | `npm run supabase -- <cmd>` — runs any CLI command with `SUPABASE_ACCESS_TOKEN` taken from `.env.local`, which overrides the machine-global `~/.supabase/access-token` |
| `scripts/db-push.mjs` | `npm run db:push` — pushes to the linked project if `supabase/.temp/project-ref` exists, else falls back to `SUPABASE_DB_URL`. Validates the connection string and echoes the target host before writing |
| `lib/supabase/server.ts` | secret-key (`sb_secret_…`) client, `server-only` guarded; `isSupabaseConfigured` flag, legacy-key warning. Used for writes only — see below |
| `lib/db/pg.ts` | `getDb()` — direct Postgres client (`postgres.js`) over `SUPABASE_DB_URL`, for reads only. Cached on `globalThis`, not a module-level singleton — see Known issues. `max: 2`, `idle_timeout: 20` — both load-bearing, see Connection pool |
| `lib/db/rows.ts` | snake_case row types mirroring the schema |
| `lib/db/mappers.ts` | row ↔ domain translation both directions (`column_name`→`column`, `sort_order`→`order`, null→`''`) |
| `lib/db/queries.ts` | `loadSnapshot()` — reads all eight CRM tables (including `leads`) in one pass over `lib/db/pg.ts`; calls `connection()` to stay per-request; falls back to mock data when `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL` is missing. **`loadGoals()`** is a second, deliberately separate read for the direction-board tables (`goals`, `goal_metrics`, `personal_goals`) — not a key on `CRMSnapshot`, and its rows never enter the CRM store. It also returns the current week's event counts and the derived revenue/customers/pipeline totals in the same pass, so a goal and its number always describe the same instant, and archives any finished week before counting this one. **`loadGoalsVersion()`** is the cheap change-stamp the wallpaper polls. The wallpaper reloads every 5 minutes; folding it into the snapshot would drag the whole working set through Postgres on each refresh to render three small tables. **`loadSnapshotVersion()`** is the same trick for the CRM's eight tables — the stamp every open browser polls so colleagues see each other's writes, see CRM live updates |
| `app/api/snapshot/version/route.ts` | The pollable stamp. Re-checks the session in its own body (a Route Handler is reachable by direct fetch), `Cache-Control: no-store`, and returns only a timestamp and a count so a leaked stamp reveals nothing but "something changed" |
| `app/api/snapshot/route.ts` | The re-read, reached only after the stamp moves. Returns `{ version, snapshot }` with the version read **first** — see CRM live updates for why the ordering matters. The first `app/api/` routes in the repo: these are app-wide data endpoints with no page to colocate against, unlike the wallpaper's `version` route |
| `app/actions/crm.ts` | 21 Server Actions — create + update per entity, plus delete for leads/notes/strategy columns/tasks/opportunities, returning `{ ok }` rather than throwing. Every one is gated on the session via `run()`/`guardedOk()` — see Auth gate |
| `app/actions/auth.ts` | `login` / `logout`. Kept separate from `crm.ts`: those are narrow writes the store calls after an optimistic update, these are form handlers that set cookies and redirect |
| `lib/store/provider.tsx` | `CRMStoreProvider` — builds one store per request **containing** the snapshot, so the server HTML and the hydration pass both render real rows; `useCRMStore` resolves it from context |

Reads happen once per full page load in `app/layout.tsx` (now `async`), and only
when the request carries a valid session — an unauthenticated request never
reaches the database (see Auth gate). Client navigation re-uses the store. Writes are optimistic — local state first, then
the Server Action, no awaiting. Record IDs are generated client-side so the
optimistic row and the stored row are the same row — via `newId()` in
`lib/utils.ts`, which prefers `crypto.randomUUID()` and falls back to a
timestamp+random string. **`crypto.randomUUID` is only defined in a secure
context**, so on a plain-HTTP LAN origin (the dev server also binds a network
address) it is `undefined` and a bare call would mint records with `id:
undefined`. `AddLeadModal` and `AddProspectModal` both use `newId()` — see
Known issues for the remaining call sites that still call
`crypto.randomUUID()` directly.

**Runs without Supabase credentials.** No `.env.local` means demo data, a boot
warning, and writes that no-op. The UI is identical either way.

**`AUTH_PASSWORD` and `AUTH_SECRET` are the exception — those are required.**
Unlike the Supabase variables there is no fallback: `verifyPassword()` and the
signing helper both throw if their variable is missing, deliberately, because
the alternatives are a gate that accepts everything or one that accepts nothing
silently. Demo mode still needs them.

### Migrations & CLI (npm scripts)

| Script | Does |
|---|---|
| `npm run db:status` | dry run — lists migrations that would be applied |
| `npm run db:push` | applies pending migrations (`-- --include-seed` also runs `seed.sql`) |
| `npm run db:link -- --project-ref <ref>` | links the CLI to a project |
| `npm run backfill:events` | dry run — reconstructs missing `crm_events` (`-- --apply` writes) |
| `npm run supabase -- <cmd>` | any other CLI command, same scoped auth |

Twelve migration files exist; all are applied to `wmnobqhypkocirfybqsj` (see the
opening summary for the most recent ones). The headline migration was pushed through the
`SUPABASE_DB_URL` path while the access token was stale, which is exactly the
fallback that path exists for — schema changes never need a Management API
token. `task_assignee` reached the database the same way; its `--yes` push was
blocked client-side by the assistant's own permission classifier before
returning a result, so it was verified by querying `information_schema.columns`
directly rather than trusting the CLI's exit code.

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
- `addOpportunity` — new prospect from `AddProspectModal`; files it at the end of its stage's column rather than trusting the caller's placeholder `order`
- `addToPipeline` — sets `inPipeline: true`, resets stage to `'New'` (or a given stage), and appends to that stage's column
- `moveOpportunityCard`, `updateOpportunity` — drag/drop pipeline stage changes and reordering (resequences the destination column so `order` stays dense, same as `moveStrategyCard`), and general field edits (stage/priority/followedUpBy/dealValue/followUpDate/nextStep/tags from `DetailDrawer`'s inline editors)
- `removeOpportunity` — permanent prospect delete from `DetailDrawer`'s footer; prunes the opportunity's own notes/strategy cards locally (the database cascades them)
- `addNote`, `dismissNote`, `applyNote`, `deleteNote` — note management; apply updates matching opportunity, delete backs `NotesTimeline`'s per-entry delete button
- `addStrategyColumn`, `renameStrategyColumn`, `removeStrategyColumn` — strategy headlines (removing one prunes its cards locally; the database cascades)
- `moveStrategyCard`, `addStrategyCard` — strategy card management; a move resequences the destination lane so `order` stays dense
- `addTask`, `toggleTaskComplete` — task management
- `addCompany`, `updateCompany`, `addContact`, `updateContact` — company/contact records; `updateCompany` backs both `DetailDrawer`'s click-to-edit company-name field and `CompanyDrawer`'s click-to-edit enrichment fields (revenue/employeeCount/about); `updateContact` backs `DetailDrawer`'s contact-name field
- `addLead`, `updateLead`, `removeLead` — the new lightweight Lead entity; `updateLead` backs `LeadDrawer`'s click-to-edit contact name/source/notes fields; `removeLead` is permanent, used both when a lead is promoted into a Prospect and when removed outright
- `applyRemoteSnapshot` — swaps the eight data collections for a freshly polled snapshot, leaving settings/sidebar/search alone; returns `false` and applies nothing while a local write is in flight or a drag is active. See CRM live updates
- `pauseRemoteSync` / `resumeRemoteSync` — depth-counted hold on remote merges, bracketed around a pipeline drag
- `syncError` / `clearSyncError` — last failed write (set and logged, not yet rendered). Now more visible a gap than it was: a write that fails leaves a local row the database never got, and the next remote merge erases it
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
| `strategy.ts` | 6 headlines + 10 strategy cards for the Nordvik Capital opportunity; every other demo deal opens empty |
| `tasks.ts` | 8 realistic tasks linked to opportunities/companies, mix of overdue/today/upcoming/completed |
| `leads.ts` | 2 example leads (Halcyon Robotics with a connection/source, Fjord Analytics with neither) for the credential-free demo-data fallback, wired into `demoSnapshot()` in `lib/db/queries.ts` |
| `goals.ts` | A full demo direction board — 1 north star, 3 annual outcomes, 3 quarter priorities, 2 principles, 3 "not now", 4 scoreboard metrics, and personal goals for all three colleagues. Enough in every section that the wallpaper layout can be judged before a real row exists. Returned by `loadGoals()` rather than `demoSnapshot()`, since goals are a separate read path |

### Sound (lib/sound.ts)

`playCheckChime()` — the only audible thing in the app. Synthesised through Web
Audio rather than shipped as a file; lazy `AudioContext`, wrapped so a blocked
or exhausted context can never take the interaction down with it. Callers gate
on the `sounds` setting; the module itself does not read settings.

### Types (lib/types/index.ts)
- `Priority` — `'low' | 'medium' | 'high' | 'critical'`
- `Stage` — 9 pipeline stages
- `ColleagueId` — `'erik' | 'abdi' | 'hai'`, the fixed assignment roster (see Tasks); metadata (name, avatar color) lives in `lib/colleagues.ts`, not this file
- `Company` (with three new optional enrichment fields: `revenue?: number` — base-currency, same convention as `Opportunity.dealValue`; `employeeCount?: number`; `about?: string` — see Company enrichment fields above), `Contact`, `Opportunity` (with `inPipeline` — prospects only appear on the pipeline board once explicitly added, `followedUpBy?: ColleagueId` — who on the team is following this prospect up, `order: number` — position within its stage's column on the pipeline board, see Pipeline board interaction — and `lastInteraction` is now editable after creation, not just set once at capture time), `Lead` (new: `{ id, companyName (required), contactName?, connection?, source?, followedUpBy?: ColleagueId, priority, notes, createdAt }` — raw, unqualified interest with no company/contact/opportunity records until promoted to a Prospect, at which point the Lead row is deleted; `Lead.followedUpBy` means who *added* the lead, a different scope from `Opportunity.followedUpBy`'s "who's following it up"), `Note` (with `dismissed`/`applied` fields), `StrategyColumn`, `StrategyCard` (filed under `columnId`), `Task` (with optional `assignee?: ColleagueId`)
- `PipelineStage`
- **Direction board (Khyte-internal):** `GoalSection` — `'north_star' | 'goal' | 'weekly' | 'principle' | 'not_now'` (the former `'annual' | 'quarter'` pair is merged into one dated `'goal'` family — see Goals timeline above), a closed set because the wallpaper has fixed regions and a goal in an unknown section has nowhere to be drawn; `GoalStatus` — `'on_track' | 'at_risk' | 'off_track' | 'done'`; `MetricUnit` — `'currency' | 'number' | 'percent'`, a rendering hint rather than a stored format. `Goal` (`progress?` undefined means "no bar" — distinct from `0`, which draws an empty one; `targetDate?: string`, same convention as `PersonalGoal.targetDate`, only meaningful on the `goal` family), `GoalMetric` (`targetValue?` undefined means "just show the number"), `PersonalGoal` (keyed to a `ColleagueId`; carries an optional `targetDate` and `progress`, and is deliberately **not** linked to a company `Goal` — it is the operator's own life shown on their own wallpaper, not a contribution rolling up into a Khyte objective). `Goal` also carries `metricKind`/`metricTarget` for counted weekly rows. `CrmEventKind` names the four countable CRM actions. `GoalsSnapshot` bundles the rows plus `weeklyCounts` and `totals` for `loadGoals()` — deliberately **not** part of `CRMSnapshot`
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

**Grain buttons (`.btn-grain` in globals.css, driving `Button.tsx`).** A matte,
tinted-per-variant material for every solid action button, distinct from the
`.grain-card`/`.grain-modal` family above (those are static surfaces; this one
also carries hover/active/disabled states):
- **Matte, not glossy.** No specular glint, no hover sheen sweep — those were
  tried and read as polished-plastic. The fill is a lit-object gradient
  instead: an off-centre warm light pool (cream, not pure white), a soft
  shadow pool opposite it, and a faint directional undertone beneath both —
  deliberately asymmetric, since a perfectly centred gradient reads as
  "generated" rather than considered. A slight diagonal tilt (128deg) keeps
  the undertone from running dead horizontal across a short, wide button.
- **Grain is a single fine `feTurbulence` layer**, `soft-light` blended so it
  reads as dry texture rather than a graphic overlay. An earlier pass blended
  a second, coarse turbulence layer under it for more "character" — at button
  scale that read as uneven blotches muddying the color rather than grain, so
  it was pulled back out. That version is preserved as `.btn-grain-patchy` /
  `ButtonGrainPatchy.tsx`, in case the mottled look is wanted on a larger
  surface where it wouldn't just look like blotches.
- **Primary's hue leans past the muted brand `--accent`** toward a more
  saturated, less brown true orange (`color-mix` weighted toward `#C85510`) —
  deliberately bolder than the accent used for text/badges elsewhere, which
  stays as-is.
- A soft outer white glow (`0 0 14px rgba(255,255,255,0.1)`, brightening on
  hover) sits alongside the color-tinted ambient shadow, not replacing it.
- Rolled out globally: every solid `bg-accent`/`bg-accent-hover` action button
  across the app now renders through `Button`/`.btn-grain` — page-header CTAs,
  every modal's submit button, the drawer's notes-save button, capture submit.
  Toggle/filter pills were deliberately left alone (different interaction
  pattern, not a one-off action).

**Type scale (the prospects page — the old `/leads`, renamed — is the
reference).** Every tab was brought onto one scale; before this, `/tasks`,
`/companies`, `/contacts` and `/strategy` sat a full tier below `/prospects`
and the table — 13px primaries against 15px, 11px secondaries against 13.5px,
10px labels — which is what read as timid rather than deliberate.

| Role | Size |
|---|---|
| Page title | 30px `font-jakarta` semibold, `tracking-[-0.02em] leading-none` |
| Page subtitle | 15px `text-foreground/60` mono tabular |
| Section / drawer heading | 17px |
| Primary (row title, card title, setting label) | 15px |
| Body (next step, notes, control text) | 14.5px |
| Secondary (role, industry, meta) | 13.5px |
| Tag / chip | 12.5px mono |
| `label-mono` | 11.5px (13px inside `.grain-modal`) |

**Secondary text is an opacity ramp, not a token.** `text-foreground/NN` rather
than `text-muted` / `text-foreground-dim` / `text-muted-foreground`:
`/85` body · `/80` tag · `/70` card body · `/65` mono meta · `/60` secondary ·
`/45` placeholder · `/40` null. The named tokens still exist and still render
fine in both themes — the ramp is a convention, not a correctness fix — but
mixing the two is what made pages look like different products. Remaining
`text-muted` usage is confined to `AppSidebar`, `PageHeader`, `NotesTimeline`,
`CaptureBox`, `SuggestionPreviewCard` and `global-error`.

**Controls.** `Button`'s `md` is the page-level primary action
(`h-[38px] px-[18px] text-[14px]`) and `sm` sits with the filter bar and in-form
controls (`h-9 px-4 text-[13.5px]`). That size used to live as a one-off
`className` override on `/prospects` while other tabs took smaller defaults, and two
pages used `size="sm"` for a page-level action. Header action icons are 15px.

**Shared surfaces.** Both boards use the same card definition — `bg-surface
border border-border rounded-xl p-3.5 card-glow` — and the same stage pill
(`h-7 px-2.5 rounded-md text-[14px]` + `stageColors`). The pipeline column well
sits at `bg-background/60` so a `bg-surface` card separates from it the way the
prospects board's cards separate from the page.

**Typography:**
- Display: Instrument Serif (page headings, empty states — warm, editorial) via `.font-display`
- Dialog titles: Plus Jakarta Sans semibold at `tracking-[-0.02em]` via `.font-jakarta` (`Modal`, `DetailDrawer`, `ConfirmDialog`). Sized 20px rather than the serif's 21px — a semibold geometric sans carries more visual weight than 400-weight Instrument Serif at the same size, and held at 21px it competed with the section headers below it
- Dashboard chat greeting only: Source Serif 4 at weight 380 (`.font-headline`) — thinner, cleaner serif scoped to this one headline, not a global type-scale change. Chosen as a licensable stand-in for Anthropic's proprietary "Anthropic Serif" (can't embed that font without a license)
- Body: Geist Sans; dashboard uses Satoshi (loaded from Fontshare in `layout.tsx`)
- Headline/numeric: Barlow (dashboard card headers, deal values)
- The dashboard is a **deliberate exception** to the scale above only in its
  chrome — the 50px greeting, the 17px composer and the Barlow uppercase card
  labels are the surface's signature and stay. Its two card *lists* were brought
  onto the shared 15 / 13.5 / 15 values, and its colours onto the ramp. Desktop
  retains vh-clamp compression/`justify-center-safe`; mobile switches to natural
  scrolling and assistant-first order — see Layout
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
- Desktop dashboard cards never clip. The column is `overflow-y-auto` with
  `justify-center-safe` (`justify-content: safe center`), so when the stack
  outgrows the viewport it falls back to start-alignment and scrolls rather than
  spilling past both edges and being cut by `overflow-hidden`. Every vertical
  value scales with viewport height via `clamp()` with the max pinned to the
  desktop figure, so tall screens are unchanged and short ones compress instead
  of overflowing
- Mobile dashboard uses natural page scrolling and assistant-first source order;
  the desktop split/viewport lock starts at `lg`
- Mobile chrome heights are CSS variables and include top/bottom safe-area
  insets; `AppShell` reserves that space and adds left/right safe-area padding
- Sidebar: desktop-only at `lg`, 232px expanded → 64px collapsed
- Topbar: optional 64px sticky action surface with backdrop blur; returns `null`
  on routes that supply no actions
- Drawers slide via translate-x with `cubic-bezier(0.16, 1, 0.3, 1)`;
  `DetailDrawer` and route detail drawers remain mounted/inert for the exit
  animation, while centered `Modal`/`ConfirmDialog` portals unmount when closed
- Overlay: `bg-black/40 backdrop-blur-[3px]`

---

## What does NOT exist yet

- **Accounts.** There is now a gate (see Auth gate below) but no identity: one
  shared password opens the whole workspace, so the app authenticates without
  authorizing. Nothing sets `owner_id`, the RLS policies from
  `20260819120000_init.sql` still have no session to scope against, and the
  secret key still bypasses them. Per-user auth is unchanged as a next step —
  what landed is a lock on the door, not a user model.
- Delete flows for companies, contacts and strategy content — those are still
  create + update only. Tasks, notes, leads, opportunities (prospects) and
  everything on the direction board are the exceptions: `deleteTask` (reachable
  only from the task archive), `deleteNote` (the per-entry `Trash2` button in
  `NotesTimeline`, wired only in `DetailDrawer`), `deleteLead` (permanent — the
  `Trash2` button behind a `ConfirmDialog` in `LeadDrawer`, and used when a lead
  is promoted into a Prospect via `removeLead`), `deleteOpportunity` (permanent
  — the `Trash2` button behind a `ConfirmDialog` in `DetailDrawer`'s footer via
  `removeOpportunity`; notes and strategy cards cascade in the database and are
  pruned locally the same way `removeStrategyColumn` prunes its cards) and
  `deleteGoal`/`deleteGoalMetric`/`deletePersonalGoal` (the per-row `Trash2` in
  `GoalsEditor`, immediate and unconfirmed — a goal row is cheap to retype) all
  exist end to end (store or local state → Server Action → `delete().eq('id', …)`)
- Surfacing failed writes in the UI (`syncError` is set and logged, nothing renders it)
- Real AI extraction (mocked — picks random extraction for notes > 30 chars)
- Email / calendar sync
- Notifications
- Advanced cell editing in table
- Dedicated edit flows for companies, contacts, opportunities (add modals
  exist; there is still no "Edit Company"/"Edit Contact" modal). `DetailDrawer`
  now covers most of this piecemeal instead: opportunity stage, priority,
  followed-up-by, deal value, follow-up date, last-contact date, next step and
  tags are all click-to-edit inline, and the company name / primary contact
  name write through to the shared `Company`/`Contact` records. Notes are no
  longer a single editable field — they're an append-only, individually
  deletable log (see Components: `DetailDrawer.tsx`). `CompanyDrawer` (in
  `app/companies/page.tsx`) picked up the same click-to-edit treatment for its
  three new enrichment fields (revenue/employee count/about — see Company
  enrichment fields above), and `LeadDrawer` (in `app/leads/page.tsx`) picked
  it up for contact name, source and notes. What remains genuinely
  uneditable: company industry/size/location/tags, contact
  role/email/linkedin/phone, and Lead's priority/connection/followed-by.
  **Tasks** remain fully editable inline behind the pencil
- Loading states, and per-route `error.tsx` boundaries (only the root `global-error.tsx` exists)
- **Reordering on the direction board.** `sort_order` exists on all the goals
  tables and every read honours it, but nothing in `GoalsEditor` writes it —
  rows sit in creation order and there is no drag handle. The dnd-kit wiring
  from `PipelineBoard`/`StrategyBoard` is the obvious model when it matters
- **No timeline UI.** Finished weeks archive into `weekly_snapshots` and have
  been verified as landing correctly, but nothing reads them back — the
  week-by-week review the archive exists for is still unbuilt
- **Daily goals.** Discussed as a tier between weekly and personal, assignable
  to people; not built. Personal goals are the closest thing that exists
- **A late-archived week records today's targets, not that week's.** The
  actuals are recomputed correctly from `crm_events` for the right window, but
  the target is read from the goal row as it stands when the archive runs.
  Versioning goal rows would fix it and is far more machinery than a
  three-person scoreboard warrants
- **`goal_metrics.current_value` is now dead weight.** The scoreboard derives
  its actuals from `opportunities`, so only `target_value`, `label` and `unit`
  are still read. The column stays because dropping it is a migration for no
  gain, but nothing writes it any more
- **The direction board is not localized.** Every label in `GoalsEditor`,
  `WallpaperLinks` and `DisplayBoard` is hard-coded Swedish rather than going
  through `lib/i18n/` (only the sidebar nav entry has `sv`/`en` entries). The
  wallpaper is arguably right to be fixed — a desktop background has no
  language toggle — but the editor should join the rest of the app if `en` ever
  matters internally

---

## Next logical steps (not started)

1. **Accounts** — the shared-password gate is in (see Auth gate); what remains is
   identity. Supabase Auth, then set `owner_id` on insert and swap the secret-key
   client for a session-scoped one on the publishable key (see `docs/database.md`),
   which is what finally gives the RLS policies a session to scope against. The
   per-request store this also required is already done — see State Management.
   Two smaller follow-ons from the gate itself: **`logout()` exists in
   `app/actions/auth.ts` but nothing calls it** — there is no way to end a
   session from the UI short of clearing cookies — and the rate limiter should
   move off per-process memory if this ever runs on more than one instance
2. **Surface `syncError`** — a toast, so a failed save is visible without the console
3. **AI extraction** — hook CaptureBox submit to Claude API via server action
4. **Edit flows** — edit drawers for companies, contacts, opportunities (add modals done)
5. **Real-time** — Supabase realtime subscriptions for pipeline updates
6. **Motion library integration** — `motion` v12 is now used for the task
   check-off (shared-layout flight between columns). The rest of the app is
   still CSS keyframes; migrate the drawers and modals next if the richer
   interactions are wanted
7. **Physical mobile acceptance pass** — validate long-press board drag/drop,
   notch/home-indicator insets and virtual-keyboard resizing on real iOS and
   Android hardware. Browser viewport QA is complete; this is feel/hardware QA
8. **Tasks ↔ weekly momentum view.** Not the wallpaper — the operator decided
   tasks connecting to the wallpaper would be redundant with the non-negotiables
   already there. Instead, `/tasks` (or a new view beside it) should show which
   tasks were *completed* within the same Monday-start week window
   `weekStart()` (`lib/db/board-metrics.ts`) already uses for the CRM event
   counters, per colleague, next to that week's non-negotiable counts — "here's
   what each person actually did this week" beside "here's what the team
   counted this week". `Task` has no `completedAt`, only `completed: boolean`
   and `dueDate` — a task finished today and one finished three weeks ago look
   identical, so this needs a `completed_at timestamptz` column before the
   window filter means anything. Small, additive migration; not started
9. **Weekly AI summary.** A scheduled (cron-driven, weekly) job that reads the
   past week's `crm_events`, completed tasks (see #8) and notes, and writes a
   short digest: strongest team result, strongest individual contribution, and
   suggested next steps. Explicitly a step *after* #8 — a summary of "who did
   what" needs the completed-tasks-by-week data to exist first. Not started;
   see the **AI Assistant design** section below for the shared reasoning layer
   this and the assistant in #10 should both be built on, rather than each
   rolling its own prompt-and-fetch logic
10. **Context-aware assistant ("Donna").** The highest-leverage and
    highest-risk item on this list — worth its own design pass rather than a
    one-line bullet. See **AI Assistant design (Donna)** immediately below.

---

## AI Assistant design (Donna)

**Priority: build this before anything else in "Next logical steps" once
accounts (#1) land.** Everything else on that list is a bounded, mechanical
change to one file or one table. This one is not — it reads across the entire
CRM, and getting the *retrieval* and *trust* boundaries wrong produces an
assistant that is confidently, plausibly wrong, which is worse than no
assistant. An agent picking this up should treat this section as the spec, not
as inspiration for a fresh design — the constraints below come from mistakes
that are cheap to describe in advance and expensive to discover in production.

**What it's for.** Not a chatbot bolted onto the dashboard. The brief was
"a context-aware agent like Donna in Suits" — someone who has read everything,
remembers what everyone else forgot, and taps you on the shoulder with the one
thing you were about to miss. Concretely: surfacing loose ends (a prospect gone
quiet, a follow-up date that passed with no note, a task overdue against a deal
that's supposedly "Won this quarter") and opportunities still worth developing
(a Contacted-stage lead with no activity in three weeks, a strategy card marked
important with no task behind it). It is a **read-and-suggest** layer, not a
read-and-act one — see Guardrails below for why.

### Why this is hard to get right (read before designing anything else)

- **Accuracy compounds against the CRM's own honesty rules.** The rest of this
  codebase draws a hard line between *current state* (recomputed from
  `opportunities` every read — moving a deal out of Won lowers revenue again)
  and *events* (append-only facts in `crm_events` that never change once
  logged — see Derived board metrics above). An assistant that blends these
  carelessly will say things that are true of neither: e.g. "you booked 5
  meetings this week" read from current stage instead of from `crm_events`
  would silently drop every meeting whose deal later moved past that stage.
  **The assistant must inherit this same current-state-vs-event split**, never
  invent a third way of reading the data.
- **Context window vs. correctness.** "Context-aware" cannot mean "dump the
  whole CRM into the prompt every time" — this is a live-editable, growing
  dataset (opportunities, notes, tasks, strategy cards, goals, events), and an
  LLM given too much loosely-relevant context degrades rather than improves
  (it starts citing the wrong prospect, or a stale note, with total
  confidence). This needs a **retrieval step before the reasoning step** —
  pull only what's relevant to the question or the scheduled sweep, not
  everything. See Architecture below.
- **Silent staleness is worse than a visible gap.** The whole existing app is
  built around "never show a number that could be lying" (see the derived
  board metrics section, the read-your-own-write pattern in `updateOpportunity`
  for stage-change events). An assistant that caches a summary of "what's going
  on with Meridian Labs" and shows it three days stale, with no timestamp, is a
  worse failure mode than not having the feature — it actively misleads someone
  who trusts the app to always be honest. **Every surfaced insight needs a
  visible "as of" timestamp and the specific records it was computed from**,
  the same way the weekly non-negotiables show "2/5" rather than just "on
  track".
- **A false positive costs trust permanently.** A human ("did you follow up
  with Nordvik?") tolerates being wrong sometimes. An automated system that is
  wrong even once ("Nordvik has gone quiet" when Marcus called yesterday and
  it just hadn't been logged as a note yet) trains the operator to ignore it
  from then on, and the whole feature is dead the first time that happens.
  Bias every heuristic toward **recall over precision for a first pass, but
  require an explicit confidence/reasoning trail per suggestion** so a wrong
  one is at least explicable and fixable rather than a mysterious black box.

### Architecture

Three layers, deliberately separate — this mirrors the "current state vs.
events" split already proven out elsewhere in this codebase rather than
inventing a new shape:

1. **Fact layer (no LLM involved).** A set of plain SQL/TypeScript queries —
   not prompts — that compute the boring, deterministic parts: "opportunities
   with no note or stage change in N days", "tasks overdue by M days against
   an open opportunity", "leads sitting in the inbox longer than the median
   time-to-promotion", "strategy cards with no task referencing the same
   opportunity". Each of these is small, testable, and exactly as trustworthy
   as any other query in `lib/db/queries.ts` — because it *is* one. This layer
   produces **candidates**, not prose. Reuses `crm_events` and the existing
   snapshot reads; adds new narrow queries alongside `board-metrics.ts` rather
   than a new subsystem.
2. **Reasoning layer (LLM, narrow context per call).** Takes a *small*, fact-
   layer-selected bundle — one prospect's full history (its notes, stage
   changes, related tasks, strategy cards), not the whole CRM — and asks a
   single, scoped question: "is this genuinely stalled, and why, in one
   sentence." This is where the Claude API / Agent SDK belongs (see the
   `claude-api` skill in this environment for current model/pricing/tool-use
   guidance before building this). Never let this layer decide *what counts as
   a candidate* — that's the fact layer's job, kept separate specifically so
   the expensive, fuzzy part of the system can't silently change which
   prospects even get looked at.
3. **Delivery layer.** Where the output actually surfaces. Candidates for
   this, roughly in order of how much of the rest of the app they reuse: a
   dashboard card (the dashboard's `CaptureBox`/`SuggestionPreviewCard` pattern
   already exists for "AI extracted this, apply or dismiss" — see Components
   above, though both are currently orphaned since `/inbox` was removed and
   would need re-homing here), a digest similar to the weekly AI summary
   (#9), or a dedicated `/assistant` surface. Whichever is chosen, it must
   carry the same apply/dismiss affordance `SuggestionPreviewCard` already
   has — a suggestion is not a fact until a human confirms it, which is the
   same trust boundary `applyNote()` already enforces for AI-extracted notes
   today (see State Management: `applyNote`).

**Scheduling.** There is no cron in this app today — the closest precedent is
`archiveFinishedWeeks()` running opportunistically on read (wallpaper poll)
rather than on a schedule (see Derived board metrics). The same
run-on-next-read approach likely fits the weekly summary (#9); a `/assistant`
sweep is more plausibly triggered on a real schedule (Vercel Cron or similar)
since "tap someone on the shoulder within a day of a lead going quiet" doesn't
tolerate waiting for an unrelated page load the way a weekly digest does. Pick
per-feature; don't force one mechanism on both.

### Guardrails (non-negotiable, not a nice-to-have)

- **Read-and-suggest, never read-and-act.** This assistant must never call
  `updateOpportunity`, `deleteTask`, or any other mutating Server Action
  directly. It produces suggestions a human applies, mirroring `applyNote()`'s
  existing apply/dismiss pattern exactly — not a new, more autonomous pattern.
  The moment this assistant can silently change a stage or close a task on its
  own judgment, a wrong inference becomes a wrong CRM record instead of an
  ignorable notification.
- **Every suggestion cites its sources.** Not "Nordvik looks stalled" — "no
  note or stage change since {date}, last activity was {event}, opportunity
  last touched by {colleague}". If the reasoning layer can't point at the
  specific rows that produced a claim, don't ship the claim.
- **No new implicit authority scope.** The whole app currently runs on one
  shared password with no per-user identity (see Auth gate, and "What does NOT
  exist: Accounts"). An assistant that reads across the entire team's
  notes/tasks/deals is fine under that model *today*, but design its data
  access as if per-user scoping (`owner_id`) already existed and will need to
  filter by it — retrofitting an assistant that was built assuming
  unrestricted read access, once accounts land, is much harder than building
  it scoped from the start.
- **Cost is a real constraint, not an afterthought.** A sweep over every
  prospect on every page load would be both slow and expensive at LLM-call
  cost. The fact layer's whole job is to make the reasoning layer's job small
  — check candidate counts stay in the tens, not the hundreds, before wiring
  this to a real schedule.

**Sequencing recommendation for whoever builds this:** ship the fact layer
first, entirely on its own, as a plain list ("N prospects with no activity in
14+ days") with zero LLM involved — that alone is useful, immediately
trustworthy (it's just a query), and proves out the candidate-selection logic
before spending any LLM budget reasoning about it. Add the reasoning layer
only once the fact layer's candidate list has been eyeballed against reality
for a few weeks and found to actually track "things a person would flag."

---

## Known issues / open decisions

- ~~No data persistence — all state resets on page refresh~~ — fixed: the store
  hydrates from Postgres and writes back through Server Actions. Still resets on
  refresh if no `.env.local` is present, which is the intended demo-mode behaviour
- ~~Pages render empty until the client store fills, sometimes never~~ — fixed
  2026-08-21. Every store-backed page server-rendered its empty state (`/leads`
  — since renamed to `/prospects` — shipped `No leads match the current
  filters.` and zero table rows), and the real data only appeared once a
  subscriber noticed the store had changed. That check lives in a passive
  effect, so a backgrounded tab could defer it indefinitely — the page would
  sit at "0 of 0 opportunities" until you switched back to the tab. Cause:
  `StoreHydrator` wrote the snapshot in *after* the store was created, but
  `useSyncExternalStore` renders SSR and hydration from `getInitialState()`,
  which Zustand fixes at construction. Fix: build the store with the snapshot
  (see State Management). That page now server-renders all rows (seven at the
  time; eight now that `leads` is a table too). This also removed the
  shared-singleton-across-requests problem that would have leaked one
  operator's data into another's render once auth landed
- **Use the Session pooler connection string, not Direct connection.**
  `db.<ref>.supabase.co` resolves to IPv6 only; on an IPv4 network the CLI fails
  with `getaddrinfo ENOTFOUND`, which reads like a wrong project ref but is not.
  `aws-0-<region>.pooler.supabase.com` has an A record and works. The pooler
  username is `postgres.<project-ref>`, not plain `postgres`
- **PowerShell makes a successful `db:push` look like a crash.** The CLI writes
  progress to stderr, and PowerShell renders any native-command stderr as a red
  `NativeCommandError` block. The trailing JSON line is the real result — check
  that before assuming failure
- **A newly added enum value cannot be used in the same migration transaction
  that added it.** `20260830120000_goal_target_date.sql` originally did
  `alter type goal_section add value 'goal'` followed by
  `update ... set section = 'goal'` in one file — `db:push` runs a file as one
  transaction, and Postgres rejected the `update` with `SQLSTATE 55P04`,
  "unsafe use of new value of enum type", the first time this was actually
  pushed. The earlier `20260828140100_weekly_goal_section.sql` had claimed
  "Postgres 12+ does allow adding and using an enum value inside one
  transaction (verified against this database)" — that migration never
  actually tested the claim (it added `'weekly'` but never read it back in the
  same file), so the comment was untested, not verified, and turned out to be
  wrong. **Fix, and the rule going forward:** an `alter type ... add value`
  that a later statement in the same push needs to read must live in its own
  migration file, so it commits before the file that uses it runs. See
  `20260830120000_goal_target_date.sql` (just the enum add) and
  `20260830120100_goal_target_date_backfill.sql` (the column and backfill
  that reads it) for the corrected shape
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
- **Physical-device mobile QA remains.** Browser checks cover 320–1440px,
  light/dark themes, overflow, dialogs, navigation and the 1024px handoff, but
  long-press drag feel and real notch/home-indicator behavior still need one pass
  on physical iOS and Android devices. **Add the modal scroll fix to that pass**
  — the `pointer-events`/`100dvh` change below was reasoned from the hit-test
  and verified by build, never by a finger on glass
- Dashboard chat is mock-only (canned replies matched on keywords); mic dictation depends on the browser's Web Speech API (works in Chrome/Edge, silent no-op elsewhere)
- `CaptureBox` / `SuggestionPreviewCard` are orphaned since `/inbox` was removed — reuse or delete when the capture flow finds a new home
- ~~Capture modals could not be scrolled on mobile~~ — fixed 2026-08-26.
  A tall form (`AddLeadModal`, `AddProspectModal` et al) could not be dragged
  past the fold on a phone; a mouse wheel scrolled the same modal fine on
  desktop, which is what made this look like a layout bug rather than a
  pointer one. Cause: `Modal.tsx`'s scroll container carried
  `pointer-events-none` with the panel re-enabling it via `pointer-events-auto`
  — an old trick for letting backdrop clicks through. **Touch scrolling is
  hit-test driven**: a drag scrolls the nearest scrollable ancestor *of the
  element under the finger*, and with pointer events off on the scroller a drag
  starting over the panel found no scrollable ancestor at all. A wheel event
  ignores the hit test and walks the box tree, hence desktop working. Fix: keep
  pointer events on the scroller and move close-on-press there behind an
  `e.target === e.currentTarget` check (the scroller is `relative` and paints
  over the `absolute` backdrop, so the backdrop's own handler had become
  unreachable — it is now the scrim and nothing else). `h-full` also became
  `h-[100dvh]`: `height: 100%` against a `fixed inset-0` parent resolves to the
  layout viewport, so a full-height panel's footer sat behind the mobile URL
  bar. Fixes all five Add… modals at once. `DetailDrawer` uses a plain
  `flex-1 overflow-y-auto` child and never had the bug.
  **Not yet confirmed on physical hardware** — verified by build and by
  reasoning about the hit-test, not by scrolling on a real phone; folded into
  the physical-device pass already open below
- ~~Capture modals were desktop-first functional passes~~ — fixed. Prospect,
  contact, company and task modals now share safe-area phone gutters, 16px/44px
  controls, programmatic labels, single-column mobile grids and stacked actions;
  `AddProspectModal` retains its richer validation/dirty-discard behavior
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
  pattern instead; `FormFields.tsx`'s new `InlineSelect<T extends string>` is the
  general-purpose version of that same pattern — a button plus an
  absolutely-positioned `role="listbox"`, click-outside-to-close — now also used
  by `DetailDrawer` for Stage/Priority/Followed-up-by inline editing. Worth
  remembering before reaching for a native select elsewhere
- ~~Supabase intermittently rejects reads with `PGRST303 / JWT issued at future`~~
  — **fixed 2026-08-24, not just mitigated.** `loadSnapshot()` (`lib/db/queries.ts`)
  no longer goes through PostgREST at all: `readSnapshot()` now runs seven plain
  `SELECT`s over a direct Postgres connection (`lib/db/pg.ts`, `postgres.js`, via
  `SUPABASE_DB_URL`). That connection mints no JWT, so there is nothing for
  `PGRST303` to reject — the fault is structurally impossible on this path, not
  retried-around. This was the "real exit" the retry docs below had already
  named; the 8s skew budget in `lib/db/retry.ts` was extended once (2026-08-21)
  and hit its ceiling again, which is what prompted actually taking the exit
  instead of extending it further.

  Writes are unchanged — `app/actions/crm.ts` still goes through PostgREST via
  `getSupabase()`, and `lib/db/retry.ts` still retries auth-timing faults there
  (2.5s budget). A write-side recurrence of this fault is still possible in
  principle; only the read path (the one that takes the whole app down on
  failure, per the "no fallback to demo data" policy above) was made immune.

  Verified by hand: typecheck clean, `/companies` / `/leads` / `/pipeline` all
  load real rows with no console errors, and repeated Turbopack hot-reloads (see
  below) kept working throughout.

  Historical detail on the fault itself — not the local clock (the API's `Date`
  header ran ~2s *ahead* of this machine; every part of the exchange is
  validated server-side), self-clearing, ~4s observed duration, trigger never
  identified — is preserved in `lib/db/retry.ts`'s header comment and in git
  history (`9c9cd60`, `8fc1933`'s predecessor) rather than duplicated here.

  **Side effect found 2026-09-01:** moving reads to a different driver also
  moved them out from under `TRANSIENT_READ`, whose patterns all described
  PostgREST/fetch faults. The read path kept a retry predicate that could no
  longer match anything it saw, trading a rare JWT fault for an unretried
  connection blip. Fixed by teaching the pattern the driver's own error strings
  — see "Read retries came back" under Error handling.

- **New from the fix above: `postgres.js` must be cached on `globalThis`, not a
  module-level singleton.** Supabase's Session pooler caps concurrent clients per
  project (`pool_size: 15`). Every other client in this codebase (Supabase,
  PostgREST) is stateless HTTP, so a plain module-level `let cached = ...` was
  fine for it. A real connection pool is not: Next's dev server re-evaluates
  route modules on every hot reload, and a module-level cache re-runs that
  initializer each time, opening a fresh pool while the previous one's
  connections are still held open server-side. Hit this firsthand mid-session —
  a handful of edits to `lib/db/queries.ts` was enough to exhaust 15 connections
  and take the page down with `(EMAXCONNSESSION) max clients reached in session
  mode`, ironically the same "whole app fails loud" symptom as the fault just
  fixed. `lib/db/pg.ts` caches the pool on `globalThis` instead (survives module
  re-evaluation, one pool per server process) and caps it at `max: 5` so it can
  never approach the ceiling even under reload churn. Confirmed holding steady
  through 8 forced hot-reloads with zero errors after the fix.

  Worth remembering if a second direct-Postgres client is ever added anywhere
  else in this codebase — the module-level pattern every other singleton here
  uses (`lib/supabase/server.ts`) is wrong for anything that holds a real
  connection.
- **Only `AddProspectModal` guards against discarding a half-filled form.** It
  tracks dirtiness and raises `ConfirmDialog`; `AddContactModal` and
  `AddCompanyModal` throw typed input away silently on Esc, backdrop click, or
  Cancel — and so does the new lightweight `AddLeadModal` (it has no
  dirty-tracking at all; a half-filled lead is small enough to not warrant the
  guard). Note the filename swap: `AddLeadModal.tsx` used to be the component
  with the guard, back when it was the rich Opportunity-capture form; that
  behavior lives in `AddProspectModal.tsx` now. The dialog is generic and the
  wiring is a few lines each — left undone for the other modals deliberately,
  because it changes their close behaviour and that was not the task at hand
- ~~`LeadCard` was the last component on the old type/touch scale~~ — fixed in
  the mobile pass; pipeline cards now use the shared readable scale, visible
  focus treatment and touch-safe controls
- Adding a prospect from the pipeline "Add Prospects" picker resets its stage to "New" even if it was further along — intentional per spec, revisit if it feels wrong in use
- **Five call sites still call `crypto.randomUUID()` directly** instead of
  `newId()` — `AddCompanyModal`, `AddContactModal` (×2), `CaptureBox`,
  `dashboard/page` (×2), `tasks/page`. They mint `id: undefined`
  when the app is opened over plain HTTP on a LAN address rather than
  `localhost`. Harmless on localhost and in production over HTTPS; a one-line
  swap each when someone is in those files
- ~~Strategy board cards state is duplicated (local + Zustand)~~ — fixed: the board derives headlines and cards straight from the store, so switching deals re-renders it
- ~~Pipeline board also duplicates opportunity state locally for drag/drop~~ — fixed: board now derives cards straight from store-backed props
- ~~`Source_Serif_4` without an explicit weight failed under an earlier
  Turbopack build~~ — no longer reproducible on Next 16.2.1; the variable-font
  configuration passes the production build
- Sidebar and capture modals are now permanently dark-styled regardless of the page theme (see Design System note above); Topbar and regular content cards still switch with the theme toggle — revisit if the split ever feels inconsistent
