import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  Opportunity,
  Company,
  Contact,
  Lead,
  Note,
  StrategyCard,
  StrategyColumn,
  Task,
  Stage,
  CRMSnapshot,
  Settings,
  AppLanguage,
} from '@/lib/types'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import * as api from '@/app/actions/crm'
import type { ActionResult } from '@/app/actions/crm'

/**
 * Client-side working set.
 *
 * One store is built per page load from the server snapshot (see
 * lib/store/provider) and is the source of truth for the rest of the session.
 * Every mutation applies locally first, then fires the matching Server Action
 * to persist it — the UI stays instant and drag/drop never waits on a
 * round-trip.
 *
 * The snapshot goes in at construction rather than being written afterwards,
 * and that is load-bearing. `useSyncExternalStore` renders both the server
 * pass and the client's hydration pass from `getInitialState()`, which zustand
 * freezes at creation time — a store filled after the fact still renders empty
 * through hydration, and only corrects once a subscriber notices, which is not
 * guaranteed to happen promptly (a backgrounded tab defers the passive effect
 * that does the checking). Building the store with the data means there is
 * nothing to correct.
 *
 * Failures are not rolled back: yanking a card back across the board a second
 * after the user dropped it is worse than leaving it and reporting the problem.
 * A failed write lands in `syncError` instead; the value is set but nothing
 * renders it yet, so a failed save is currently visible only in the console.
 * Wiring it to a toast is the natural next step.
 */

export interface CRMStore {
  // Display settings
  settings: Settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  resetSettings: () => void
  /** Applies the browser's saved preferences. Client-only; see AppShell. */
  hydrateSettings: () => void
  toggleTheme: () => void

  // Data
  opportunities: Opportunity[]
  companies: Company[]
  contacts: Contact[]
  leads: Lead[]
  notes: Note[]
  strategyColumns: StrategyColumn[]
  strategyCards: StrategyCard[]
  tasks: Task[]

  // Sync state
  /** Message from the most recent failed write, if any. */
  syncError: string | null
  clearSyncError: () => void
  /**
   * Swaps the eight data collections for a freshly read snapshot, leaving
   * every piece of UI state (settings, sidebar, search) alone.
   *
   * Returns false when the merge was refused rather than applied — a caller
   * that gets `false` must not mark the incoming version as seen, or the
   * change it was carrying is lost until the next unrelated write. See the
   * implementation for the two things that refuse it.
   */
  applyRemoteSnapshot: (snapshot: CRMSnapshot) => boolean
  /**
   * Holds off remote merges during an interaction that must not have the
   * ground moved under it — a pipeline drag, above all. Paired calls; the
   * board resumes on drop and on cancel.
   */
  pauseRemoteSync: () => void
  resumeRemoteSync: () => void

  // UI state
  sidebarCollapsed: boolean
  searchQuery: string

  // Actions — Opportunities
  addOpportunity: (opportunity: Opportunity) => void
  updateOpportunity: (opportunityId: string, updates: Partial<Opportunity>) => void
  addToPipeline: (opportunityId: string, stage?: Stage) => void
  /**
   * Files a card under `newStage`, at `targetIndex` in that column or at the
   * end when the index is omitted. Used for every pipeline-board drag, a
   * same-stage reorder included — the column is rebuilt around the drop
   * either way.
   */
  moveOpportunityCard: (
    cardId: string,
    newStage: Stage,
    targetIndex?: number
  ) => void
  /** Permanent — for prospects created in error or otherwise no longer wanted. */
  removeOpportunity: (opportunityId: string) => void

  // Actions — Notes
  addNote: (note: Note) => void
  dismissNote: (noteId: string) => void
  applyNote: (noteId: string) => void
  deleteNote: (noteId: string) => void

  // Actions — Strategy
  addStrategyColumn: (column: StrategyColumn) => void
  renameStrategyColumn: (columnId: string, title: string) => void
  /** Removes the headline and every card filed under it. */
  removeStrategyColumn: (columnId: string) => void
  /**
   * Files a card under `newColumnId`, at `targetIndex` in that lane or at the
   * end when the index is omitted.
   */
  moveStrategyCard: (
    cardId: string,
    newColumnId: string,
    targetIndex?: number
  ) => void
  addStrategyCard: (card: StrategyCard) => void

  // Actions — Tasks
  addTask: (task: Task) => void
  toggleTaskComplete: (taskId: string) => void
  updateTask: (taskId: string, updates: Partial<Task>) => void
  /** Files a task away without removing it. Pass `false` to restore. */
  archiveTask: (taskId: string, archived?: boolean) => void
  /** Permanent — for tasks created in error. Prefer archiveTask. */
  deleteTask: (taskId: string) => void

  // Actions — Companies & Contacts
  addCompany: (company: Company) => void
  updateCompany: (companyId: string, updates: Partial<Company>) => void
  addContact: (contact: Contact) => void
  updateContact: (contactId: string, updates: Partial<Contact>) => void

  // Actions — Leads
  addLead: (lead: Lead) => void
  updateLead: (leadId: string, updates: Partial<Lead>) => void
  /** Permanent — used when a lead is promoted into a Prospect, or removed outright. */
  removeLead: (leadId: string) => void

  // Actions — UI
  toggleSidebar: () => void
  setSearchQuery: (query: string) => void
}

export type CRMStoreApi = StoreApi<CRMStore>

const SETTINGS_KEY = 'khyte-settings'
/** Pre-settings builds stored only the theme under this key. */
const LEGACY_THEME_KEY = 'khyte-theme'

function applyTheme(theme: Settings['theme']): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

function saveSettings(settings: Settings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Private mode or a full quota — the session still works, it just won't
    // survive a reload. Not worth interrupting the user over.
  }
}

/**
 * Reads saved preferences, falling back per-key so a partial or older blob
 * still yields a complete Settings object. Unknown keys are dropped.
 */
function readSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY)
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    const savedLanguage: AppLanguage | undefined =
      parsed.language === 'sv' || parsed.language === 'en' ? parsed.language : undefined

    // A blob without `language` predates interface localization. Start that
    // browser in the new Swedish UI/formatting defaults while preserving its
    // explicit currency, theme, date-format and compact-number choices.
    const preLocalizationSettings = raw !== null && savedLanguage === undefined
    return {
      ...DEFAULT_SETTINGS,
      // Carry a pre-settings theme choice forward; an explicit saved theme wins.
      ...(legacyTheme === 'dark' || legacyTheme === 'light' ? { theme: legacyTheme } : {}),
      ...parsed,
      language: savedLanguage ?? DEFAULT_SETTINGS.language,
      ...(preLocalizationSettings ? { locale: DEFAULT_SETTINGS.locale } : {}),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function shallowEqualSettings(a: Settings, b: Settings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every((k) => a[k] === b[k])
}

/**
 * Builds a store holding `snapshot`.
 *
 * Called once per provider mount — which on the server means once per request,
 * so concurrent requests no longer share one operator's working set. That was
 * always going to be a problem once auth landed; it is fixed here because the
 * same change fixes hydration.
 */
export function createCRMStore(snapshot: CRMSnapshot): CRMStoreApi {
  /**
   * Serialises writes in the order the store made them.
   *
   * This is not just tidiness — it is required for correctness. Creating a lead
   * from a new company fires createCompany, createContact and createOpportunity
   * back to back, and the last two carry foreign keys to the first. Fired in
   * parallel they can reach Postgres out of order and fail the constraint. One
   * operator generates a handful of writes a minute, so a queue costs nothing.
   *
   * Scoped to the store so two stores never share a queue.
   */
  let writeQueue: Promise<unknown> = Promise.resolve()

  /**
   * How many writes have been fired but not yet settled.
   *
   * A remote snapshot read while this is above zero cannot see the write that
   * is still in flight, so merging it would roll the user's own change back on
   * screen a moment after they made it. Counted here rather than in store
   * state because nothing renders it — only applyRemoteSnapshot reads it.
   */
  let pendingWrites = 0

  /** Depth, not a boolean: nested pauses must not resume early. */
  let syncPauseDepth = 0

  return createStore<CRMStore>()((set, get) => {
    /**
     * Fire a write without blocking the caller, recording any failure.
     * Deliberately not awaited — the optimistic update has already landed.
     */
    function persist(label: string, run: () => Promise<ActionResult>): void {
      pendingWrites += 1
      writeQueue = writeQueue
        .then(run)
        .then((result) => {
          if (!result.ok) {
            set({ syncError: `${label} — ${result.error}` })
          }
        })
        // Swallow here so one failed write does not poison every write after it.
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          console.error(`[khyte] ${label} failed:`, message)
          set({ syncError: `${label} — ${message}` })
        })
        .finally(() => {
          pendingWrites -= 1
          // Nudge anything showing derived server-side figures — the weekly and
          // daily count cards — now that a write has landed. Broadcast as an
          // event rather than an import so the store stays unaware of the UI;
          // nothing listening is a no-op. The cards still poll as a backstop
          // for work done in another tab, but their own page's writes should
          // not wait up to a minute to show up.
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('khyte:crm-write'))
          }
        })
    }

    return {
      // Display settings — defaults on both server and client so the first
      // client render matches the server HTML; saved values are applied
      // afterwards by hydrateSettings(). Reading localStorage here instead
      // would desync the two.
      settings: DEFAULT_SETTINGS,

      setSetting: (key, value) =>
        set((state) => {
          // The generic guarantees value matches Settings[K], but TypeScript widens
          // a computed-key spread to `string`, so the narrowing has to be restated.
          const next = { ...state.settings, [key]: value } as Settings
          saveSettings(next)
          if (key === 'theme') applyTheme(next.theme)
          return { settings: next }
        }),

      resetSettings: () =>
        set(() => {
          saveSettings(DEFAULT_SETTINGS)
          applyTheme(DEFAULT_SETTINGS.theme)
          return { settings: DEFAULT_SETTINGS }
        }),

      hydrateSettings: () =>
        set((state) => {
          const saved = readSettings()
          applyTheme(saved.theme)
          // Skip the re-render when nothing was stored or it matches the defaults.
          return shallowEqualSettings(state.settings, saved) ? {} : { settings: saved }
        }),

      toggleTheme: () =>
        set((state) => {
          const theme: Settings['theme'] = state.settings.theme === 'dark' ? 'light' : 'dark'
          const next: Settings = { ...state.settings, theme }
          saveSettings(next)
          applyTheme(theme)
          return { settings: next }
        }),

      // The server snapshot, in place before the first render
      companies: snapshot.companies,
      contacts: snapshot.contacts,
      opportunities: snapshot.opportunities,
      leads: snapshot.leads,
      notes: snapshot.notes,
      strategyColumns: snapshot.strategyColumns,
      strategyCards: snapshot.strategyCards,
      tasks: snapshot.tasks,

      // Sync state
      syncError: null,

      clearSyncError: () => set({ syncError: null }),

      applyRemoteSnapshot: (snapshot) => {
        // A write of our own is still in the air. The snapshot on the wire was
        // read before it landed, so applying it now would visibly undo the
        // change the user just made. Refusing is cheap — the poll comes back.
        if (pendingWrites > 0) return false

        // Mid-drag, or any other interaction that holds a reference to a row
        // it is moving. Rebuilding the collections underneath it is how a card
        // ends up dropped into a column that no longer exists.
        if (syncPauseDepth > 0) return false

        // Only the eight data collections. Settings, sidebar, search query and
        // syncError belong to this browser, not to the database, and a merge
        // that reset the user's filters every time a colleague saved something
        // would be worse than no sync at all.
        set({
          companies: snapshot.companies,
          contacts: snapshot.contacts,
          opportunities: snapshot.opportunities,
          leads: snapshot.leads,
          notes: snapshot.notes,
          strategyColumns: snapshot.strategyColumns,
          strategyCards: snapshot.strategyCards,
          tasks: snapshot.tasks,
        })

        return true
      },

      pauseRemoteSync: () => {
        syncPauseDepth += 1
      },

      resumeRemoteSync: () => {
        syncPauseDepth = Math.max(0, syncPauseDepth - 1)
      },

      // UI defaults
      sidebarCollapsed: false,
      searchQuery: '',

      // Opportunities
      addOpportunity: (opportunity) => {
        // Filed at the end of its stage's column, not wherever the caller's
        // draft `order` happened to be — the same rule moveOpportunityCard
        // enforces for a drag, so a brand-new card and a moved one land the
        // same way.
        const stageSiblings = get().opportunities.filter((o) => o.stage === opportunity.stage)
        const placed = { ...opportunity, order: stageSiblings.length }
        set((state) => ({ opportunities: [placed, ...state.opportunities] }))
        persist('Save lead', () => api.createOpportunity(placed))
      },

      // Leads enter the board at 'New' by default — or straight into a given
      // stage, when added from that stage's column rather than the generic picker.
      addToPipeline: (opportunityId, stage = 'New') => {
        const order = get().opportunities.filter(
          (o) => o.stage === stage && o.id !== opportunityId
        ).length
        set((state) => ({
          opportunities: state.opportunities.map((o) =>
            o.id === opportunityId ? { ...o, inPipeline: true, stage, order } : o
          ),
        }))
        persist('Add to pipeline', () =>
          api.updateOpportunity(opportunityId, { inPipeline: true, stage, order })
        )
      },

      // Board drag-and-drop: changes stage and position together. Rebuilds the
      // destination column around the drop so `order` stays a dense 0..n-1
      // sequence — same rationale as moveStrategyCard, which this mirrors.
      moveOpportunityCard: (cardId, newStage, targetIndex) => {
        const card = get().opportunities.find((o) => o.id === cardId)
        if (!card) return

        const column = get()
          .opportunities.filter((o) => o.stage === newStage && o.id !== cardId)
          .sort((a, b) => a.order - b.order)
        column.splice(targetIndex ?? column.length, 0, { ...card, stage: newStage })

        const moved = column
          .map((o, order) =>
            o.order === order && o.stage === newStage && o.id !== cardId
              ? null
              : { ...o, stage: newStage, order }
          )
          .filter((o): o is Opportunity => o !== null)
        const byId = new Map(moved.map((o) => [o.id, o]))

        set((state) => ({
          opportunities: state.opportunities.map((o) => byId.get(o.id) ?? o),
        }))

        for (const o of moved) {
          persist('Move stage', () =>
            api.updateOpportunity(o.id, { stage: o.stage, order: o.order })
          )
        }
      },

      updateOpportunity: (opportunityId, updates) => {
        set((state) => ({
          opportunities: state.opportunities.map((o) =>
            o.id === opportunityId ? { ...o, ...updates } : o
          ),
        }))
        persist('Update lead', () => api.updateOpportunity(opportunityId, updates))
      },

      // The database cascades notes and strategy cards; the local sets have to
      // be pruned by hand or they would linger tied to a prospect that no
      // longer exists — see removeStrategyColumn for the same shape.
      removeOpportunity: (opportunityId) => {
        set((state) => ({
          opportunities: state.opportunities.filter((o) => o.id !== opportunityId),
          notes: state.notes.filter((n) => n.opportunityId !== opportunityId),
          strategyCards: state.strategyCards.filter((c) => c.opportunityId !== opportunityId),
        }))
        persist('Delete prospect', () => api.deleteOpportunity(opportunityId))
      },

      // Notes
      addNote: (note) => {
        set((state) => ({ notes: [note, ...state.notes] }))
        persist('Save note', () => api.createNote(note))
      },

      dismissNote: (noteId) => {
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === noteId ? { ...n, dismissed: true } : n
          ),
        }))
        persist('Dismiss note', () => api.updateNote(noteId, { dismissed: true }))
      },

      applyNote: (noteId) => {
        const state = get()
        const note = state.notes.find((n) => n.id === noteId)
        if (!note?.aiExtracted) return

        const ai = note.aiExtracted

        // If the note references a company, find the matching opportunity and work
        // out which fields the extraction actually changes.
        let targetId: string | null = null
        let changes: Partial<Opportunity> = {}

        if (ai.company) {
          const company = state.companies.find(
            (c) => c.name.toLowerCase() === ai.company!.toLowerCase()
          )
          if (company) {
            const opp = state.opportunities.find((o) => o.companyId === company.id)
            if (opp) {
              targetId = opp.id
              changes = {
                ...(ai.suggestedStage && { stage: ai.suggestedStage }),
                ...(ai.nextStep && { nextStep: ai.nextStep }),
                ...(ai.followUpDate && { followUpDate: ai.followUpDate }),
              }
            }
          }
        }

        set((current) => ({
          opportunities: targetId
            ? current.opportunities.map((o) =>
                o.id === targetId ? { ...o, ...changes } : o
              )
            : current.opportunities,
          notes: current.notes.map((n) =>
            n.id === noteId ? { ...n, applied: true } : n
          ),
        }))

        persist('Apply note', () => api.updateNote(noteId, { applied: true }))
        if (targetId && Object.keys(changes).length > 0) {
          persist('Apply note to lead', () =>
            api.updateOpportunity(targetId!, changes)
          )
        }
      },

      deleteNote: (noteId) => {
        set((state) => ({ notes: state.notes.filter((n) => n.id !== noteId) }))
        persist('Delete note', () => api.deleteNote(noteId))
      },

      // Strategy
      addStrategyColumn: (column) => {
        set((state) => ({ strategyColumns: [...state.strategyColumns, column] }))
        persist('Save headline', () => api.createStrategyColumn(column))
      },

      renameStrategyColumn: (columnId, title) => {
        set((state) => ({
          strategyColumns: state.strategyColumns.map((k) =>
            k.id === columnId ? { ...k, title } : k
          ),
        }))
        persist('Rename headline', () =>
          api.updateStrategyColumn(columnId, { title })
        )
      },

      removeStrategyColumn: (columnId) => {
        // The database cascades the cards; the local set has to be pruned by
        // hand or they would linger as cards with no lane to render in.
        set((state) => ({
          strategyColumns: state.strategyColumns.filter((k) => k.id !== columnId),
          strategyCards: state.strategyCards.filter((c) => c.columnId !== columnId),
        }))
        persist('Delete headline', () => api.deleteStrategyColumn(columnId))
      },

      moveStrategyCard: (cardId, newColumnId, targetIndex) => {
        const card = get().strategyCards.find((c) => c.id === cardId)
        if (!card) return

        // Rebuild the destination lane around the drop so `order` stays a
        // dense 0..n-1 sequence. Writing only the dragged card would leave two
        // cards sharing an order, and the tie would be broken differently
        // after a reload than it was on screen.
        const lane = get()
          .strategyCards.filter(
            (c) => c.columnId === newColumnId && c.id !== cardId
          )
          .sort((a, b) => a.order - b.order)
        lane.splice(targetIndex ?? lane.length, 0, { ...card, columnId: newColumnId })

        const moved = lane
          .map((c, order) => (c.order === order && c.id !== cardId ? null : { ...c, order }))
          .filter((c): c is StrategyCard => c !== null)
        const byId = new Map(moved.map((c) => [c.id, c]))

        set((state) => ({
          strategyCards: state.strategyCards.map((c) => byId.get(c.id) ?? c),
        }))

        for (const c of moved) {
          persist('Move strategy card', () =>
            api.updateStrategyCard(c.id, { columnId: c.columnId, order: c.order })
          )
        }
      },

      addStrategyCard: (card) => {
        set((state) => ({ strategyCards: [...state.strategyCards, card] }))
        persist('Save strategy card', () => api.createStrategyCard(card))
      },

      // Tasks
      addTask: (task) => {
        set((state) => ({ tasks: [task, ...state.tasks] }))
        persist('Save task', () => api.createTask(task))
      },

      toggleTaskComplete: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId)
        if (!task) return
        const completed = !task.completed

        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, completed } : t)),
        }))
        persist('Update task', () => api.updateTask(taskId, { completed }))
      },

      updateTask: (taskId, updates) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, ...updates } : t
          ),
        }))
        persist('Update task', () => api.updateTask(taskId, updates))
      },

      archiveTask: (taskId, archived = true) => {
        const archivedAt = archived ? new Date().toISOString() : undefined
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, archivedAt } : t)),
        }))
        persist('Archive task', () => api.updateTask(taskId, { archivedAt }))
      },

      deleteTask: (taskId) => {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }))
        persist('Delete task', () => api.deleteTask(taskId))
      },

      // Companies & Contacts
      addCompany: (company) => {
        set((state) => ({ companies: [...state.companies, company] }))
        persist('Save company', () => api.createCompany(company))
      },

      updateCompany: (companyId, updates) => {
        set((state) => ({
          companies: state.companies.map((c) =>
            c.id === companyId ? { ...c, ...updates } : c
          ),
        }))
        persist('Update company', () => api.updateCompany(companyId, updates))
      },

      addContact: (contact) => {
        set((state) => ({ contacts: [...state.contacts, contact] }))
        persist('Save contact', () => api.createContact(contact))
      },

      updateContact: (contactId, updates) => {
        set((state) => ({
          contacts: state.contacts.map((c) =>
            c.id === contactId ? { ...c, ...updates } : c
          ),
        }))
        persist('Update contact', () => api.updateContact(contactId, updates))
      },

      // Leads
      addLead: (lead) => {
        set((state) => ({ leads: [lead, ...state.leads] }))
        persist('Save lead', () => api.createLead(lead))
      },

      updateLead: (leadId, updates) => {
        set((state) => ({
          leads: state.leads.map((l) =>
            l.id === leadId ? { ...l, ...updates } : l
          ),
        }))
        persist('Update lead', () => api.updateLead(leadId, updates))
      },

      removeLead: (leadId) => {
        set((state) => ({ leads: state.leads.filter((l) => l.id !== leadId) }))
        persist('Remove lead', () => api.deleteLead(leadId))
      },

      // UI
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSearchQuery: (query) => set({ searchQuery: query }),
    }
  })
}
