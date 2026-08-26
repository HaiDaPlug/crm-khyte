# Khyte CRM — Current State

**Date:** 2026-08-26
**Phase:** MVP + persistence + password gate (Supabase live; shared-password auth, no accounts)

The database is provisioned and running. Project ref `wmnobqhypkocirfybqsj`
(eu-north-1); schema and seed applied; reads and writes verified end to end
against the live API.

**Two migrations are pending.** `npm run db:status` reports
`20260825140000_lead_contact_fields` and `20260826120000_opportunity_followed_up_by`
as not yet pushed — run `npm run db:push`. `20260824170000_task_archive` (adds
`tasks.archived_at`) is applied. `lead_contact_fields` adds
`contact_name`/`connection`/`source`/`followed_up_by` to `public.leads`, and
`opportunity_followed_up_by` adds `followed_up_by` to `public.opportunities` —
until these land, a Lead's contact/connection/source/followed-up-by and an
Opportunity's followed-up-by are readable and writable in the UI but the
corresponding columns do not exist on the remote, so those specific fields
fail to persist (the base `leads` table itself, from `20260825120000_leads.sql`,
is already live).

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
| `/leads` | Functional | New, lightweight raw-interest inbox — a card grid, not the table/board pair below. No Company/Contact/Opportunity record exists until a lead is promoted. Clicking a card opens an inline `LeadDrawer` (defined in `app/leads/page.tsx`) showing the full record — including source, which the card doesn't show — with a "promote to prospect" button; each card also carries its own promote action. "New Lead" (`AddLeadModal.tsx`) is a small single-column form: company name (required), contact name, connection ("koppling" — someone in your network who knows the contact), source, "Tillagd av"/"Added by" via `AssigneePicker` (semantically who added the lead, not who's following it up), priority via `ColorSlider`, notes. Promoting opens `AddProspectModal` pre-filled via `fromLeadId`; submitting deletes the lead (`removeLead`) rather than keeping it around alongside the new Prospect. |
| `/prospects` | Functional | Renamed from the old `/leads`; unchanged in behavior. TanStack sorting/filtering plus board view and detail drawer. At `< md`, the dense table becomes purpose-built cards; the board uses phone-width snap columns with a next-column peek. Search and filters are wired, and table/board empty results now show localized recovery guidance instead of blank space. "New Prospect" (`AddProspectModal.tsx`) uses labelled company/contact comboboxes and a single-column mobile form; selecting a pipeline stage adds the prospect to the board. It also gained an optional "start from a lead" search combobox (only rendered when `leads.length > 0`) that pre-fills company name, contact name, priority and notes from a Lead — see `/leads` above. |
| `/pipeline` | Functional | Nine-stage dnd-kit kanban with mouse, delayed long-press touch and keyboard sensors. Mobile columns snap horizontally, expose a next-column peek/edge cue, and use natural page height instead of a locked viewport. Active value, drop feedback, off-board picker, background panning and drag-edge auto-scroll remain intact. Source data is Opportunities (Prospects), not the new Leads. |
| `/strategy` | Functional | Opportunity selector + per-deal strategy board with add/rename/delete. The selector, summary and empty state reflow on phones; board columns snap/peek horizontally, touch actions stay visible, and drag supports mouse, long-press touch and keyboard input. |
| `/companies` | Functional | Responsive card grid with deal/contact counts and total value. Search has a localized no-result state and clear action. Detail view becomes a full-screen, safe-area-aware mobile dialog with focus trap, Escape close, body-scroll lock and focus restoration. "New Company" is a single-column mobile modal. |
| `/contacts` | Functional | Responsive list with search, localized no-result recovery, and 44px mobile actions. The contact detail view is a full-screen, safe-area-aware mobile dialog with focus trap/Escape/scroll lock/focus return. "New Contact" uses a labelled company combobox and single-column mobile form. |
| `/tasks` | Functional | Three derived groups — **On pace / Late / Completed** — stack vertically below `lg`. Completion controls have accessible names/states and 44px hit areas; the inline editor no longer hijacks Enter from nested buttons. `AddTaskModal` is single-column on phones with labelled fields, readable date control and stacked actions. Archive/delete behavior is unchanged. |
| `/settings` | Functional | Display preferences remain app-wide and `localStorage`-backed. The page now uses responsive cards, stacked controls and mobile-safe spacing while preserving dark/light, language, locale, currency, date, compact-number and sound settings. |

### Components
```
components/
  layout/
    AppShell.tsx       — client wrapper; mounts `CRMStoreProvider`, applies theme/language settings, reserves mobile top/bottom chrome space, adds horizontal safe-area insets, and closes the mobile menu on route change or when crossing into the desktop breakpoint
    AppSidebar.tsx     — desktop-only (`lg+`) 232px → 64px collapsible sidebar; grain-nav burnt-orange treatment, theme toggle and shared exported nav definition used by the mobile chrome
    MobileChrome.tsx   — fixed mobile header + five-item bottom navigation (Dashboard, Prospects, Pipeline, Tasks, More). `primaryHrefs` lists `/prospects`, not the new lightweight `/leads` — Leads is reachable only via the `More` drawer. `More` opens an inert-while-closed, focus-trapped, Escape-dismissible navigation drawer with theme control; all chrome handles top/bottom/left/right safe-area insets
    Topbar.tsx         — optional sticky action bar; returns `null` when a route supplies no actions
  crm/
    CaptureBox.tsx     — textarea input, Cmd+Enter submit, simulated AI extraction (800ms delay) — orphaned since /inbox was removed
    SuggestionPreviewCard.tsx — AI extraction card with Apply (updates matching opportunity) / Dismiss — orphaned since /inbox was removed
    CRMTable.tsx       — sortable TanStack table at `md+`, backing `/prospects`; purpose-built mobile cards below `md` surface company, stage, contact, value, next step, follow-up, pipeline status and priority without horizontal page overflow
    PipelineBoard.tsx  — dnd-kit kanban with mouse, delayed touch and keyboard sensors, drag overlay/drop feedback, mobile snap/peek columns and natural phone height. Shared `useBoardPan` and `useEdgeAutoScroll` behavior remains; empty slots still open the stage-scoped off-board picker
    LeadCard.tsx       — touch-safe kanban card with mobile-sized type/controls, visible focus treatment, company/contact/priority/value and amber hover glow
    StrategyBoard.tsx  — store-derived dnd-kit strategy board with mouse/touch/keyboard sensors, mobile snap/peek columns, visible phone actions, and responsive inline add/rename forms
    DetailDrawer.tsx   — portaled slide-in drawer; full-width/full-`dvh` with square edges and left/right/top/bottom safe-area handling on phones, 520px on desktop. `role="dialog"`, focus trap, initial focus, Escape, body-scroll lock, focus return, `aria-hidden`/`inert` closed state and labelled inline editors. Retains its payload for the exit animation. Company name (h2 header) and Primary Contact's name are click-to-edit inline text fields that write through to the shared `Company`/`Contact` records via `updateCompany`/`updateContact`. Stage and Priority are inline-edited via the new `InlineSelect` popover (commits immediately, no draft). A 5th Deal tile, "Followed up by" (`followedUpBy` on Opportunity — who on the team is following this prospect up), is also an `InlineSelect`, using `''` as an unassigned sentinel since the component needs a real string value. Notes are a running, deletable log rather than one field to overwrite: a small compose textarea (⌘↵ or a button) calls `addNote()`, each submission becomes its own timeline entry, and the timeline renders a hover-visible delete button per entry via `NotesTimeline`'s `onDelete`. The old single-field notes editor and its dirty/discard `ConfirmDialog` flow are gone entirely
    NotesTimeline.tsx  — chronological notes with AI-extracted indicator; takes an optional `onDelete?: (noteId: string) => void` that renders a hover-visible `Trash2` delete button per entry (omit the prop for a read-only timeline)
    FilterBar.tsx      — stage + priority filters with semantic expanded/pressed state, inert collapsed content, horizontally scrollable mobile chips and 44px phone targets
    ViewToggle.tsx     — labelled table/board toggle group with pressed states and full-width phone layout
    EmptyState.tsx     — centered empty state with icon + message
    Modal.tsx          — safe-area-aware portaled modal shell, unmounted when closed; phone gutters, responsive title/spacing and stacked full-width mobile footer. Shared `useDialogBehavior` supplies focus trap, Escape, scroll lock and focus return; title labelling and nested-dialog suspension remain. The scroll container keeps pointer events and owns close-on-press; the backdrop is now purely the scrim — see Known issues for why
    ConfirmDialog.tsx  — safe-area-aware `role="alertdialog"` with stacked full-width phone actions and focus on the safe choice
    FormFields.tsx     — shared mobile-safe form primitives. Inputs are 44px/16px on phones (prevents iOS focus zoom); all modal `Field` labels are wired to stable control IDs, comboboxes retain full keyboard/listbox semantics, `AssigneePicker` has labelled group semantics, and `ColorSlider`/`DateStepper` remain keyboard operable. Gained `InlineSelect<T extends string>` — a small dark popover (button + absolutely-positioned `role="listbox"`, click-outside-to-close) standing in for native `<select>`; used by `DetailDrawer` for Stage/Priority/Followed-up-by, the general-purpose version of the popover pattern `/settings` already used
    AddLeadModal.tsx   — now the lightweight capture form for the new raw-interest `Lead` entity (company name required, contact name, connection, source, "Tillagd av"/Added-by via `AssigneePicker`, priority via `ColorSlider`, notes). No dirty-tracking or discard confirmation — it's a small form with little to lose. This filename previously held the rich Opportunity-capture modal; that component's content moved to the new `AddProspectModal.tsx` below
    AddProspectModal.tsx — the rich capture modal (renamed from the old `AddLeadModal.tsx`, unchanged behavior): single-column phone grids, 44px stage choices, labelled company/contact comboboxes, two-way autofill, pipeline membership, priority/deal/next step/follow-up/tags/notes, inline value/email validation and unsaved-changes confirmation (dirty-tracking + `ConfirmDialog`) all remain. Widened `w-[860px]` → `w-[1120px]`; the stage pill row is now `sm:flex-nowrap`/`whitespace-nowrap` so all 10 stage pills fit one line at desktop width instead of wrapping. Gained an optional "start from a lead" `Combobox` (shown only when `leads.length > 0`) that pre-fills company name/contact name/priority/notes from a `Lead` — folding the lead's connection/source into the notes text, since Opportunity has no dedicated field for either — and a `fromLeadId?: string | null` prop to open pre-filled directly. Submitting while promoted from a lead calls `removeLead(leadId)`, deleting it
    AddContactModal.tsx — contact essentials in a single-column phone layout; labelled company combobox, mobile email/phone/URL keyboards and stacked actions
    AddCompanyModal.tsx — company essentials in a single-column phone layout with labelled fields, URL keyboard hint and stacked actions
    AddTaskModal.tsx   — single-column phone task capture with labelled title/description/date/assignee controls, responsive priority/date layout and stacked actions
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

### Shared Config (lib/stage-config.ts)
- `STAGES: Stage[]` — canonical ordered list of the 9 pipeline stages
- `stageColors: Record<Stage, string>` — Tailwind badge classes for all 9 pipeline stages
- `priorityDot: Record<Priority, string>` — fixed hex colors (not Tailwind theme classes) for all 4 priority levels: critical `#E05252`, high `#E09040`, medium `#D4943C`, low `#4CAF72`. Deliberately not theme tokens — `bg-accent`/`bg-muted` shift hue between light/dark by design, but a priority indicator needs to read as the same color regardless of theme. Consumers apply it via inline `style={{ background: priorityDot[p] }}`, not className
- `priorityRamp: Record<Priority, { from: string; to: string }>` — two-stop gradients for the priority `ColorSlider`. Kept **separate** from `priorityDot` rather than replacing it: a 6px dot reads best flat and saturated, while a large fill needs a gradient. `priorityDot` now has ten consumers, including the new `leads/page` cards and drawer
- Single source of truth; imported by `CRMTable`, `prospects/page`, `leads/page`, `pipeline/page`, `AddProspectModal` (stage pills), `FilterBar`, `LeadCard`, and `dashboard/page` — previously `FilterBar`, `LeadCard`, and the dashboard each had their own duplicate (and inconsistent) local copy; consolidated into this one

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

### Tasks (app/tasks/page.tsx)

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
| `lib/db/retry.ts` | Transient faults on **writes** only now (`app/actions/crm.ts`, via PostgREST). Bounded by *elapsed time*, not attempt count: 2.5s for auth-timing faults, waiting 250ms → 500ms → 1s → then a flat 750ms. Reads no longer go through this — see Data Layer and the clock-skew entry under Known issues |
| `app/global-error.tsx` | Everything a write's retry can't, plus any read failure — renders a themed screen with a working retry button |

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
spending the whole budget on a fault that was never going to clear.

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
all 20 bodies** — inside `run()` (everything that touches the database) and
`guardedOk()` (the early returns that never reach `run()`). A 21st action
cannot be added without a session check unless it bypasses both. Both early-out
paths needed it: the 20 `skipUnconfigured()` returns would have been a real hole
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
| `supabase/migrations/20260819120000_init.sql` | 6 tables, 3 enums, indexes, `updated_at` triggers, RLS enabled with owner-scoped policies. One of those enums, `crm_strategy_column`, is dropped again by the migration below |
| `supabase/migrations/20260821120000_strategy_headlines.sql` | `strategy_columns` table; backfills the six enum lanes into per-opportunity headlines, repoints `strategy_cards.column_name` → `column_id`, drops the `crm_strategy_column` enum |
| `supabase/migrations/20260824120000_task_assignee.sql` | `crm_colleague` enum (`erik`/`abdi`/`hai`), nullable `tasks.assignee` column — plain enum, not a foreign key, same reasoning as `crm_priority` (no real accounts yet, see Tasks) |
| `supabase/migrations/20260824170000_task_archive.sql` | `tasks.archived_at`. Applied |
| `supabase/migrations/20260825120000_leads.sql` | new `public.leads` table (`id`, `owner_id`, `company_name text not null`, `priority`, `notes`, timestamps), RLS + owner policy, index on `owner_id`, `updated_at` trigger. Deliberately no FK to companies/contacts — promoting a Lead to a Prospect is what creates those records, and the Lead row is deleted at that point. Applied |
| `supabase/migrations/20260825140000_lead_contact_fields.sql` | adds `contact_name`, `connection`, `source`, `followed_up_by crm_colleague` (reuses the enum from `task_assignee` above) to `public.leads` — pending |
| `supabase/migrations/20260826120000_opportunity_followed_up_by.sql` | adds `followed_up_by crm_colleague` to `public.opportunities` — pending |
| `supabase/seed.sql` | the former mock data as real rows, fixed UUIDs, re-runnable |
| `supabase/config.toml` | local CLI config from `supabase init`; not a project link |
| `scripts/supabase.mjs` | `npm run supabase -- <cmd>` — runs any CLI command with `SUPABASE_ACCESS_TOKEN` taken from `.env.local`, which overrides the machine-global `~/.supabase/access-token` |
| `scripts/db-push.mjs` | `npm run db:push` — pushes to the linked project if `supabase/.temp/project-ref` exists, else falls back to `SUPABASE_DB_URL`. Validates the connection string and echoes the target host before writing |
| `lib/supabase/server.ts` | secret-key (`sb_secret_…`) client, `server-only` guarded; `isSupabaseConfigured` flag, legacy-key warning. Used for writes only — see below |
| `lib/db/pg.ts` | `getDb()` — direct Postgres client (`postgres.js`) over `SUPABASE_DB_URL`, for reads only. Cached on `globalThis`, not a module-level singleton — see Known issues |
| `lib/db/rows.ts` | snake_case row types mirroring the schema |
| `lib/db/mappers.ts` | row ↔ domain translation both directions (`column_name`→`column`, `sort_order`→`order`, null→`''`) |
| `lib/db/queries.ts` | `loadSnapshot()` — reads all eight tables (including `leads`) in one pass over `lib/db/pg.ts`; calls `connection()` to stay per-request; falls back to mock data when `SUPABASE_SECRET_KEY` or `SUPABASE_DB_URL` is missing |
| `app/actions/crm.ts` | 20 Server Actions — create + update per entity, plus delete for leads/notes/strategy columns/tasks, returning `{ ok }` rather than throwing. Every one is gated on the session via `run()`/`guardedOk()` — see Auth gate |
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
| `npm run supabase -- <cmd>` | any other CLI command, same scoped auth |

Seven migration files exist; five are applied to `wmnobqhypkocirfybqsj`
(`init`, `strategy_headlines`, `task_assignee`, `task_archive`, `leads`). Two are
**pending** — `20260825140000_lead_contact_fields` and
`20260826120000_opportunity_followed_up_by`, confirmed via `npm run db:status`
— run `npm run db:push`. The headline migration was pushed through the
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
- `addOpportunity` — new prospect from `AddProspectModal`
- `addToPipeline` — sets `inPipeline: true` and resets stage to `'New'`
- `moveOpportunityStage`, `updateOpportunity` — drag/drop pipeline updates and general field edits (stage/priority/followedUpBy/dealValue/followUpDate/nextStep/tags from `DetailDrawer`'s inline editors)
- `addNote`, `dismissNote`, `applyNote`, `deleteNote` — note management; apply updates matching opportunity, delete backs `NotesTimeline`'s per-entry delete button
- `addStrategyColumn`, `renameStrategyColumn`, `removeStrategyColumn` — strategy headlines (removing one prunes its cards locally; the database cascades)
- `moveStrategyCard`, `addStrategyCard` — strategy card management; a move resequences the destination lane so `order` stays dense
- `addTask`, `toggleTaskComplete` — task management
- `addCompany`, `updateCompany`, `addContact`, `updateContact` — company/contact records; the update pair backs `DetailDrawer`'s click-to-edit company/contact name fields
- `addLead`, `updateLead`, `removeLead` — the new lightweight Lead entity; `removeLead` is permanent, used both when a lead is promoted into a Prospect and when removed outright
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
| `strategy.ts` | 6 headlines + 10 strategy cards for the Nordvik Capital opportunity; every other demo deal opens empty |
| `tasks.ts` | 8 realistic tasks linked to opportunities/companies, mix of overdue/today/upcoming/completed |
| `leads.ts` | 2 example leads (Halcyon Robotics with a connection/source, Fjord Analytics with neither) for the credential-free demo-data fallback, wired into `demoSnapshot()` in `lib/db/queries.ts` |

### Sound (lib/sound.ts)

`playCheckChime()` — the only audible thing in the app. Synthesised through Web
Audio rather than shipped as a file; lazy `AudioContext`, wrapped so a blocked
or exhausted context can never take the interaction down with it. Callers gate
on the `sounds` setting; the module itself does not read settings.

### Types (lib/types/index.ts)
- `Priority` — `'low' | 'medium' | 'high' | 'critical'`
- `Stage` — 9 pipeline stages
- `ColleagueId` — `'erik' | 'abdi' | 'hai'`, the fixed assignment roster (see Tasks); metadata (name, avatar color) lives in `lib/colleagues.ts`, not this file
- `Company`, `Contact`, `Opportunity` (with `inPipeline` — prospects only appear on the pipeline board once explicitly added, and now `followedUpBy?: ColleagueId` — who on the team is following this prospect up), `Lead` (new: `{ id, companyName (required), contactName?, connection?, source?, followedUpBy?: ColleagueId, priority, notes, createdAt }` — raw, unqualified interest with no company/contact/opportunity records until promoted to a Prospect, at which point the Lead row is deleted; `Lead.followedUpBy` means who *added* the lead, a different scope from `Opportunity.followedUpBy`'s "who's following it up"), `Note` (with `dismissed`/`applied` fields), `StrategyColumn`, `StrategyCard` (filed under `columnId`), `Task` (with optional `assignee?: ColleagueId`)
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
- Delete flows for companies, contacts, opportunities and strategy content —
  those are still create + update only. Tasks, notes and leads are the
  exceptions: `deleteTask` (reachable only from the task archive), `deleteNote`
  (the per-entry `Trash2` button in `NotesTimeline`, wired only in
  `DetailDrawer`) and `deleteLead` (permanent — used both when a lead is
  promoted into a Prospect, via `removeLead`, and when discarded outright) all
  exist end to end (store → Server Action → `delete().eq('id', …)`)
- Realtime — two open tabs do not see each other's changes until reload
- Surfacing failed writes in the UI (`syncError` is set and logged, nothing renders it)
- Real AI extraction (mocked — picks random extraction for notes > 30 chars)
- Email / calendar sync
- Notifications
- Advanced cell editing in table
- Dedicated edit flows for companies, contacts, opportunities (add modals
  exist; there is still no "Edit Company"/"Edit Contact" modal). `DetailDrawer`
  now covers most of this piecemeal instead: opportunity stage, priority,
  followed-up-by, deal value, follow-up date, next step and tags are all
  click-to-edit inline, and the company name / primary contact name write
  through to the shared `Company`/`Contact` records. Notes are no longer a
  single editable field — they're an append-only, individually deletable log
  (see Components: `DetailDrawer.tsx`). What remains genuinely uneditable:
  company industry/size/location/tags, contact role/email/linkedin/phone, and
  everything on Lead outside its own drawer/promote flow. **Tasks** remain
  fully editable inline behind the pencil
- Loading states, and per-route `error.tsx` boundaries (only the root `global-error.tsx` exists)

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
