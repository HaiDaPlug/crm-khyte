# Khyte CRM — Current State

**Date:** 2026-03-27
**Phase:** MVP Skeleton (frontend only, no backend, no auth)

---

## What exists

### Stack
- Next.js 16.2.1 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Zustand — global state management (store with mock data + actions)
- @dnd-kit/core + sortable + utilities — drag/drop
- @tanstack/react-table 8 — table shell
- lucide-react — icons
- Radix UI primitives (dialog, dropdown, separator, slot, tooltip)
- motion (framer-motion successor) — installed, not yet used in components
- clsx + tailwind-merge + class-variance-authority — style utilities

### Routes
| Route | Status | Notes |
|---|---|---|
| `/` | Done | Redirects to `/inbox` |
| `/inbox` | Functional | Capture box with simulated AI extraction, suggestion preview cards with Apply/Dismiss wired to store, expandable notes feed with relative timestamps |
| `/leads` | Functional | TanStack Table + sorting + filter bar (wired) + board view (grouped by stage) + detail drawer. Search filters data via Zustand. |
| `/pipeline` | Functional | dnd-kit kanban, 9 stages, drag between columns syncs to Zustand store. Active pipeline total value in header. Drop target feedback. |
| `/strategy` | Functional | Opportunity selector dropdown + 6-column strategy board with inline add-card forms. Cards sync to Zustand. |
| `/companies` | Functional | Card grid with deal count, contact count, total value. Search/filter input. Click-to-open detail drawer with company info, contacts, opportunities. |
| `/contacts` | Functional | List view with search/filter. Click-to-open drawer with contact info, email/LinkedIn links, company card, related opportunities. |
| `/tasks` | Functional | Grouped checklist (Overdue/Today/Upcoming/Completed). Checkbox toggle. Inline add-task form with priority selection. 8 realistic mock tasks. |

### Components
```
components/
  layout/
    AppShell.tsx       — client wrapper, dynamic margin based on sidebar collapsed state
    AppSidebar.tsx     — 232px → 64px collapsible sidebar, amber accent, icon-only collapsed mode
    Topbar.tsx         — 52px sticky top bar, functional search (reads/writes Zustand searchQuery)
  crm/
    CaptureBox.tsx     — textarea input, Cmd+Enter submit, simulated AI extraction (800ms delay)
    SuggestionPreviewCard.tsx — AI extraction card with Apply (updates matching opportunity) / Dismiss
    CRMTable.tsx       — sortable TanStack table, priority dots, stage badges, dark theme
    PipelineBoard.tsx  — dnd-kit kanban board, drag overlay, drop target feedback, stage dot indicators
    LeadCard.tsx       — kanban card: company, contact, priority, deal value, amber hover glow
    StrategyBoard.tsx  — 6-column dnd-kit board with sortable text cards, inline add forms
    DetailDrawer.tsx   — always-mounted slide-in drawer (translate-x animation), company/contact/deal/notes
    NotesTimeline.tsx  — chronological notes with AI-extracted indicator
    FilterBar.tsx      — stage + priority filters, active pills, animated panel toggle
    ViewToggle.tsx     — table/board view toggle
    EmptyState.tsx     — centered empty state with icon + message
```

### State Management (lib/store/index.ts)
Zustand store seeded with all mock data. Actions:
- `moveOpportunityStage` — drag/drop pipeline updates
- `addNote`, `dismissNote`, `applyNote` — inbox note management; apply updates matching opportunity
- `moveStrategyCard`, `addStrategyCard` — strategy board management
- `addTask`, `toggleTaskComplete` — task management
- `toggleSidebar`, `setSearchQuery` — UI state

### Mock Data (lib/mock-data/)
| File | Contents |
|---|---|
| `companies.ts` | 6 companies (Meridian Labs, Nordvik Capital, Calloway Systems, Sable Analytics, Fenwick Advisory, Orin Technologies) |
| `contacts.ts` | 6 contacts, one per company |
| `opportunities.ts` | 7 opportunities across various pipeline stages |
| `notes.ts` | 3 raw capture notes, 2 with AI extraction |
| `strategy.ts` | 10 strategy cards for Nordvik Capital opportunity |
| `tasks.ts` | 8 realistic tasks linked to opportunities/companies, mix of overdue/today/upcoming/completed |

### Types (lib/types/index.ts)
- `Priority` — `'low' | 'medium' | 'high' | 'critical'`
- `Stage` — 9 pipeline stages
- `Company`, `Contact`, `Opportunity`, `Note` (with `dismissed`/`applied` fields), `StrategyCard`, `Task`
- `StrategyColumn` — 6 columns
- `PipelineStage`

### Design System — "Darkroom Operator"
Dark, moody theme with warm amber accents — like a film darkroom with copper light.

**Colors:**
- Background: `#0E0D0C` (main), `#141312` (raised), `#1A1918` (surface), `#201F1D` (surface-raised)
- Text: `#E8E4DF` (foreground), `#B8B3AC` (dim), `#706B64` (muted)
- Accent: `#D4943C` (amber/copper), with `accent-hover`, `accent-muted`, `accent-light`, `accent-glow` variants
- Borders: `#2A2826` (primary), `#222120` (subtle), `rgba(212,148,60,0.2)` (accent)
- Semantic: `danger` (#E05252), `success` (#4CAF72) with muted variants

**Typography:**
- Display: Instrument Serif (page headings — warm, editorial)
- Body: Geist Sans
- Data/Labels: Geist Mono (uppercase, tracked, 10px — via `.label-mono` utility)

**Effects:**
- Film grain noise overlay via SVG filter on `body::before`
- Card hover glow: `.card-glow` (subtle amber shadow on hover)
- Gradient line dividers: `.line-accent`
- Pulsing indicator: `.ember-dot`
- Animations: fadeInUp, slideInDown, scaleIn, glow-pulse, line-reveal, ember-glow
- Staggered children reveal with 50ms delays
- Smooth cubic-bezier easings throughout

**Layout:**
- Sidebar: 232px expanded → 64px collapsed
- Topbar: 52px sticky with backdrop blur
- Drawers: always-mounted, slide via translate-x with `cubic-bezier(0.16, 1, 0.3, 1)`
- Overlay: `bg-black/40 backdrop-blur-[3px]`

---

## What does NOT exist yet

- Backend / database (no Supabase, no API routes)
- Authentication
- Real form handling (all inputs are local state only, no persistence)
- Real AI extraction (mocked — picks random extraction for notes > 30 chars)
- Email / calendar sync
- Notifications
- Advanced cell editing in table
- Add/edit drawers for companies, contacts, opportunities
- Mobile optimization beyond basic responsive layout
- Error boundaries or loading states

---

## Next logical steps (not started)

1. **Supabase integration** — schema + server actions for CRUD
2. **Auth** — NextAuth or Supabase Auth
3. **AI extraction** — hook CaptureBox submit to Claude API via server action
4. **Form flows** — add/edit drawers for companies, contacts, opportunities
5. **Real-time** — Supabase realtime subscriptions for pipeline updates
6. **Motion library integration** — replace CSS animations with motion for richer interactions

---

## Known issues / open decisions

- No data persistence — all state resets on page refresh (Zustand in-memory only)
- No error boundaries or loading states yet
- No mobile optimization beyond basic responsive layout
- Strategy board cards state is duplicated (local + Zustand) — needs reconciliation
- Pipeline board also duplicates opportunity state locally for drag/drop
