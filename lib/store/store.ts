import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  ActionScope,
  Opportunity,
  Company,
  Contact,
  Lead,
  StrategyBoard,
  StrategyCard,
  StrategyColumn,
  Task,
  Stage,
  CRMSnapshot,
  Settings,
  AppLanguage,
  OrganizationMember,
  Workspace,
} from '@/lib/types'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { newId } from '@/lib/utils'
import * as api from '@/app/actions/crm'
import type { ActionResult } from '@/app/actions/crm'
import * as journalActions from '@/app/actions/journal'
import type {
  JournalActionResult,
  JournalEntryActionResult,
  JournalPageActionResult,
  NextStepActionResult,
} from '@/app/actions/journal'
import { CONTEXT_MISMATCH } from '@/lib/actions/scope'
import type {
  CreateEntryInput,
  EditEntryInput,
  JournalCoverage,
  JournalEntryView,
  JournalOrigin,
  JournalPage,
  LinkTarget,
} from '@/lib/journal/contracts'
import { clearDraftsFor, type DraftStorage, type JournalSurface } from '@/lib/journal/drafts'
import { UNAUTHORIZED, isIdentityRefusal, type JournalRefreshOutcome } from '@/lib/journal/composer-state'

export interface Toast {
  id: string
  kind: 'success' | 'error'
  message: string
}

/**
 * One rendered list of Journal entries.
 *
 * The slice is normalized — entries in one map, views holding ids — because
 * the same entry is on screen in two places at once: an entry linked to a
 * prospect shows on `/journal` AND in that prospect's drawer. Held twice, an
 * edit made in the drawer would leave the global feed showing the old wording
 * until the next poll, and the two would disagree on screen in the same
 * second. One copy, many lists of ids, and an edit writes once.
 *
 * `targets` and `origins` are the filter this view was read with, kept so a
 * refresh, a Load more and the "does this new entry belong here" test all ask
 * the same question the first page asked.
 */
export interface JournalViewState {
  ids: string[]
  nextCursor: string | null
  coverage: JournalCoverage | null
  status: 'idle' | 'loading' | 'error'
  error?: string
  targets?: LinkTarget[]
  origins?: JournalOrigin[]
}

export interface JournalState {
  entries: Record<string, JournalEntryView>
  /** Keyed `dashboard`, `journal`, `prospect:<opportunityId>`. */
  views: Record<string, JournalViewState>
}

/**
 * The Server Actions the Journal half of the store calls.
 *
 * Declared as an interface and injectable (see `createCRMStore`) rather than
 * reached through the static `import * as` the CRM half uses. The CRM actions
 * can be left alone in tests because every one of them is fired and forgotten
 * by `persist`; the Journal's are awaited and their results drive what the
 * store does next — whether a draft survives, which views a new entry lands
 * in, whether a delete is rolled back — and none of that is observable without
 * being able to answer as the server. A real call needs a session and a
 * database, so a seam is the only way those paths are covered at all.
 *
 * The shape is the actions' own, so a change to one of them is a type error
 * here rather than a fake that has quietly drifted from the thing it fakes.
 */
export interface JournalApi {
  createJournalEntry: (input: unknown, scope: ActionScope) => Promise<JournalActionResult>
  editJournalEntry: (id: string, patch: unknown, scope: ActionScope) => Promise<JournalActionResult>
  deleteJournalEntry: (id: string, scope: ActionScope) => Promise<JournalActionResult>
  loadJournalPage: (input: unknown, scope: ActionScope) => Promise<JournalPageActionResult>
  /** One entry with its history. The store reads it after `revision_conflict`,
   *  so the card's "use the latest version" offers a version the store holds. */
  loadJournalEntry: (id: string, scope: ActionScope) => Promise<JournalEntryActionResult>
  /** Moves the field and files the line recording the value it replaced, in
   *  one transaction server-side. */
  changeNextStep: (opportunityId: string, next: string, scope: ActionScope) => Promise<NextStepActionResult>
}

/** What a caller may hand `createCRMStore` besides the snapshot. Both exist for
 *  the suite; production passes neither and gets the real action module and
 *  `localStorage`. */
export interface CRMStoreOptions {
  journal?: JournalApi
  draftStorage?: DraftStorage
  /** The tab's own copies of its drafts (lib/journal/drafts `ownDraft`); `sessionStorage` when omitted. */
  draftSession?: DraftStorage
}

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
 * A failed write pushes an error toast instead — see `toasts` — so the
 * optimistic row stays in place, but the user gets a chance to notice and
 * retry before the next snapshot merge quietly corrects it.
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
  /**
   * The organization this working set belongs to, who is looking, and the
   * roster. Read by the chrome (avatar, sign-out) and by Settings; written by
   * the snapshot and by the two roster actions below, nothing else.
   */
  workspace: Workspace
  opportunities: Opportunity[]
  companies: Company[]
  contacts: Contact[]
  leads: Lead[]
  strategyBoards: StrategyBoard[]
  /** Which opportunities share which board. */
  strategyBoardOpportunities: { boardId: string; opportunityId: string }[]
  strategyColumns: StrategyColumn[]
  strategyCards: StrategyCard[]
  tasks: Task[]

  // Sync state
  /**
   * Feedback for writes with no other visible confirmation — a create, a
   * delete, a form save. An error toast is added for every failed write, no
   * matter what caused it; a success toast only for the writes that pass
   * `successMessage` to `persist`, which excludes anything that already has
   * its own optimistic feedback (a drag's motion, a checkbox's chime and
   * strike) — stacking a toast on top of that would be noise, not signal.
   */
  toasts: Toast[]
  dismissToast: (id: string) => void
  /**
   * True once the server has answered as a different person or organization
   * than this store was built for — another tab logged in as someone else,
   * or this session was revoked and replaced. The store is that identity's
   * working set and must not be merged with, or write on behalf of, another;
   * SnapshotSync reloads the page, which rebuilds it from the session that
   * actually exists. Never reset: the old store is finished.
   */
  identityChanged: boolean
  /**
   * For a caller outside `persist` — the Settings roster, whose actions
   * return their rows directly — that has just been told `context_mismatch`
   * by the server. Same consequence: the store is finished, reload.
   *
   * `reason` is the refusal, when the caller has it. `'unauthorized'` takes
   * the same reload but keeps this person's drafts (see `finishIdentity`);
   * anything else, or nothing, clears them.
   */
  markIdentityChanged: (reason?: string) => void
  /**
   * Swaps the data collections and the workspace for a freshly read snapshot,
   * leaving every piece of UI state (settings, sidebar, search) alone.
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

  // Actions — Journal
  /**
   * The Journal's entries and the lists that render them.
   *
   * Deliberately NOT part of the snapshot and never merged by
   * `applyRemoteSnapshot`. The snapshot is current state — a few hundred rows
   * that every screen reads — and the Journal is history, which grows without
   * bound and is read a page at a time. It has its own version signal and its
   * own poller (components/journal/JournalSync).
   */
  journal: JournalState
  /**
   * True while somebody is writing in a composer. `refreshJournalViews`
   * stands down while it is set, so a background poll cannot re-render the
   * feed under a half-typed sentence.
   *
   * It does NOT touch `pauseRemoteSync`, deliberately. That pause exists for
   * an interaction holding a reference to a row the merge would rebuild — a
   * pipeline drag. A composer's text is component state in a subtree the CRM
   * snapshot does not feed, so pausing the snapshot merge while somebody types
   * would freeze the whole working set for no reason at all.
   */
  journalTyping: boolean
  setJournalTyping: (typing: boolean) => void
  /** Reads the first page of `key`. `targets` and `limit` are remembered and
   *  reused by Load more and by a refresh. */
  loadJournalView: (
    key: string,
    options?: { targets?: LinkTarget[]; origins?: JournalOrigin[]; limit?: number }
  ) => Promise<void>
  /** The next page of `key`, appended. No-op without a cursor. */
  loadMoreJournal: (key: string) => Promise<void>
  /**
   * Says that a feed for `key` is on screen, and later that it is not.
   *
   * Reference-counted, because the same key can be rendered twice at once —
   * the dashboard's feed and a drawer opened over it both read
   * `prospect:<id>` — and the first of the two to close must not take the
   * other's list with it.
   *
   * WHY IT EXISTS. The store outlives navigation, so without this every
   * prospect drawer ever opened leaves a `prospect:<id>` view behind, and the
   * poller re-reads all of them every twelve seconds for the rest of the
   * session. Releasing the last reference drops the view's own state; the
   * entries themselves stay in `journal.entries`, which is one copy each and
   * cheap, so reopening the drawer renders instantly and then refreshes.
   */
  acquireJournalView: (key: string) => void
  releaseJournalView: (key: string) => void
  /**
   * Re-reads every view somebody is currently looking at — the whole range
   * each one holds, not only its first page; see `refreshRange` in
   * createCRMStore.
   *
   * THE ANSWER IS FOR THE POLLER, which may only forget a version stamp once
   * the change it carries is on screen:
   *   'deferred'  somebody is typing (`journalTyping`); nothing was read.
   *   'failed'    at least one view's read ended in error.
   *   'applied'   every view on screen now shows what the server holds.
   */
  refreshJournalViews: () => Promise<JournalRefreshOutcome>
  /**
   * Writes what a composer is holding. The result is returned rather than
   * swallowed: only the composer knows whether the draft may be cleared, and
   * only `{ ok: true }` earns that.
   */
  submitCapture: (
    input: CreateEntryInput,
    options: { surface: JournalSurface; context?: { links: LinkTarget[]; label: string } }
  ) => Promise<JournalActionResult>
  /** An edit. `revision_conflict` and `deleted` come back to the card, which
   *  has the wording for both. */
  editJournalEntry: (id: string, patch: EditEntryInput) => Promise<JournalActionResult>
  /** Optimistic: the entry leaves every view at once and is put back if the
   *  write fails. */
  deleteJournalEntry: (id: string) => Promise<JournalActionResult>
  /**
   * Changes a prospect's next step. ONE Server Action moves the field and
   * files the system line recording the value it replaced, so the two cannot
   * disagree. Optimistic: the field moves at once and the returned line lands
   * in the loaded feeds; a refusal puts the previous value back and says so.
   */
  changeNextStep: (opportunityId: string, next: string) => Promise<NextStepActionResult>

  // Actions — Strategy
  createStrategyBoard: (board: StrategyBoard) => void
  /** No-op if this pair is already linked. */
  linkOpportunityToBoard: (boardId: string, opportunityId: string) => void
  unlinkOpportunityFromBoard: (boardId: string, opportunityId: string) => void
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
  editStrategyCard: (cardId: string, content: string) => void
  /** Reindexes the rest of the lane so `order` stays dense. */
  removeStrategyCard: (cardId: string) => void

  // Actions — Tasks
  /** `order` is assigned by the store — the task lands at the front of its bucket. */
  addTask: (task: Omit<Task, 'order'>) => void
  toggleTaskComplete: (taskId: string) => void
  updateTask: (taskId: string, updates: Partial<Task>) => void
  /**
   * Reorders a task among the other open (or other completed) tasks, at
   * `targetIndex` or at the end when omitted. `completed` moves it across
   * the open/done line — the on-pace/overdue split within "open" stays
   * automatic, driven by dueDate, so there is no column for this to name.
   */
  moveTask: (taskId: string, completed: boolean, targetIndex?: number) => void
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

  // Actions — Workspace
  /**
   * Replaces the roster wholesale — for a caller holding a fresh read of
   * every member. Leaves the organization and the viewer alone.
   */
  setWorkspaceMembers: (members: OrganizationMember[]) => void
  /**
   * Files one member into the roster: the row with the same id is replaced,
   * an unknown one appended. Called by Settings with what a member action
   * returned, which is the row as the database now holds it — so unlike the
   * collections above this is not optimistic and needs no protection from
   * the next merge.
   *
   * The viewer's own entry is mirrored too: renaming yourself, or being
   * promoted, shows in the chrome at once instead of on the next poll.
   */
  upsertWorkspaceMember: (member: OrganizationMember) => void

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
 * Does `a` sort after `b` in a feed — is it older?
 *
 * The feed's own order, `created_at desc, id desc` (listEntries in
 * lib/journal/service.ts), asked locally. Positive when `a` comes later in the
 * list, zero for the same entry. A timestamp that does not parse falls back to
 * comparing the strings, which for the ISO stamps the service writes is the
 * same order.
 */
function feedOrder(a: JournalEntryView, b: JournalEntryView): number {
  if (a.id === b.id) return 0
  const at = Date.parse(a.createdAt)
  const bt = Date.parse(b.createdAt)
  if (Number.isFinite(at) && Number.isFinite(bt)) {
    if (at !== bt) return at < bt ? 1 : -1
  } else if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1
  }
  return a.id < b.id ? 1 : -1
}

/**
 * Has a re-read reached the entry that was at the bottom of a view?
 *
 * Found by id, or passed by position — the old last entry may be exactly what
 * a colleague deleted, in which case the read is past it once its own oldest
 * entry sorts at or after where that one stood. Without the old entry to
 * compare with there is no position to reach, and the answer is yes.
 */
function reachedTail(
  fresh: JournalEntryView[],
  tailId: string | undefined,
  tail: JournalEntryView | undefined
): boolean {
  if (!tailId) return true
  if (fresh.some((entry) => entry.id === tailId)) return true
  const oldest = fresh.at(-1)
  if (!oldest || !tail) return true
  return feedOrder(oldest, tail) >= 0
}

/**
 * Builds a store holding `snapshot`.
 *
 * Called once per provider mount — which on the server means once per request,
 * so concurrent requests no longer share one operator's working set. That was
 * always going to be a problem once auth landed; it is fixed here because the
 * same change fixes hydration.
 */
export function createCRMStore(snapshot: CRMSnapshot, options: CRMStoreOptions = {}): CRMStoreApi {
  /** The real Server Actions unless a caller supplied stand-ins — see JournalApi. */
  const journalApi: JournalApi = options.journal ?? journalActions
  /** `undefined` leaves lib/journal/drafts on its own `localStorage` default. */
  const draftStorage = options.draftStorage
  const draftSession = options.draftSession

  /**
   * The read arguments each view was loaded with.
   *
   * Kept beside the state rather than in it because nothing renders them and
   * `JournalViewState` is a contract with the components: a limit in the view
   * object would be a fourth field every consumer has to ignore. Load more and
   * refresh read it so the second page and the re-read ask the same question
   * the first page did.
   */
  const journalLimits = new Map<string, number>()

  /**
   * How many pages each view is holding. Beside the state for the same reason
   * `journalLimits` is: nothing renders it. A poller refresh reads it to know
   * how much of the Journal to read again — the whole range the reader has
   * loaded, not only its first page (see `refreshRange`).
   */
  const journalPages = new Map<string, number>()

  /**
   * How many mounted feeds are holding each view — see `acquireJournalView`.
   * A key with no live reference is a view nobody is looking at, and the
   * poller leaves it alone.
   */
  const journalRefs = new Map<string, number>()

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

  /**
   * Records that stayed the local answer the moment a merge last checked them.
   *
   * `pendingWrites` only protects a write that is still in flight. It cannot
   * protect one that has already settled: a snapshot read can start before our
   * write commits and still arrive back after `pendingWrites` has dropped to
   * zero, carrying the pre-write row. Keying this by record rather than
   * refusing the whole merge means one recently-touched task does not also
   * freeze every unrelated row out of a legitimate update from someone else.
   *
   * Key is `${collection}:${id}`. Value is when the protection expires, set
   * once a write settles successfully — 15s is comfortably past the 12s poll
   * interval, so any poll that could have raced the write falls inside it and
   * loses to the local row; the one after that reflects the write and agrees
   * with it anyway.
   */
  const recentlyWonLocally = new Map<string, number>()
  const LOCAL_WRITE_GRACE_MS = 15_000

  function markRecent(collection: string, id: string): void {
    recentlyWonLocally.set(`${collection}:${id}`, Date.now() + LOCAL_WRITE_GRACE_MS)
  }

  /**
   * The roster under the same protection as the collections.
   *
   * A member action is awaited and files the committed row, so the write can
   * never be ahead of the server — but a poll's *read* can have started
   * before that write committed and land afterwards, carrying the old roster.
   * Without this, a member just added or renamed in Settings would vanish
   * from the list (and the viewer's own rename from the sidebar) until the
   * next poll. The viewer is re-derived from the merged roster so the two
   * cannot disagree about the person looking.
   */
  function mergeWorkspace(local: Workspace, incoming: Workspace): Workspace {
    const members = mergeCollection('members', local.members, incoming.members)
    const own = members.find((m) => m.userId === incoming.viewer.userId)
    const viewer = own
      ? { ...incoming.viewer, displayName: own.displayName, role: own.role, colleague: own.colleague }
      : incoming.viewer
    return { organization: incoming.organization, viewer, members }
  }

  /**
   * Keeps the local row for anything still inside its grace window instead of
   * accepting whatever the incoming snapshot says — including a row the
   * snapshot omits entirely, which is what an insert not yet visible to the
   * poll's read looks like. Sweeps expired entries as it goes so the map
   * cannot grow without bound.
   */
  function mergeCollection<T extends { id: string }>(
    collection: string,
    local: T[],
    incoming: T[]
  ): T[] {
    const now = Date.now()
    const localById = new Map(local.map((row) => [row.id, row]))
    const incomingIds = new Set(incoming.map((row) => row.id))
    const merged: T[] = []

    for (const row of incoming) {
      const key = `${collection}:${row.id}`
      const expiry = recentlyWonLocally.get(key)
      if (expiry !== undefined) {
        if (expiry <= now) {
          recentlyWonLocally.delete(key)
        } else {
          const localRow = localById.get(row.id)
          merged.push(localRow ?? row)
          continue
        }
      }
      merged.push(row)
    }

    // A local row the incoming snapshot doesn't have at all: only kept while
    // its own grace window holds, so a row genuinely deleted elsewhere still
    // disappears once that window lapses rather than lingering forever.
    for (const row of local) {
      if (incomingIds.has(row.id)) continue
      const key = `${collection}:${row.id}`
      const expiry = recentlyWonLocally.get(key)
      if (expiry !== undefined && expiry > now) merged.push(row)
    }

    return merged
  }

  return createStore<CRMStore>()((set, get) => {
    /**
     * What this store believes it is: the identity every write below declares.
     *
     * Read fresh at call time rather than captured once, so it is whatever the
     * store holds at the moment the action is fired. The server compares it
     * with the session that actually arrives and refuses the write on a
     * disagreement — see the header on app/actions/crm.ts. That is the guard
     * against a tab whose cookie changed underneath it (another tab signed in
     * as someone else) committing its drafts as the new person, in the new
     * person's organization, with row ids minted in the old one.
     *
     * Not an authority: nothing server-side is scoped by this. It only ever
     * makes a write fail, which persist() below turns into `identityChanged`
     * and SnapshotSync turns into a reload.
     */
    const scope = (): ActionScope => ({
      organizationId: get().workspace.organization.id,
      userId: get().workspace.viewer.userId,
    })

    function pushToast(kind: Toast['kind'], message: string): void {
      set((state) => ({ toasts: [...state.toasts, { id: newId(), kind, message }] }))
    }

    /**
     * This store belongs to a session that no longer exists here.
     *
     * One place rather than three `set({ identityChanged: true })` calls,
     * because since Stage 2 the conclusion has a second consequence: the
     * unsaved Journal drafts of the identity this store was built for are
     * dropped. SnapshotSync turns the flag into a reload, and the page that
     * comes back belongs to somebody else — offering them this person's
     * half-written sentence, or leaving it in storage for them to find, is
     * not something a reload should be able to do.
     *
     * EXCEPT WHEN NOBODY ELSE IS HERE. `keepDrafts` is the `unauthorized`
     * case: this person's session or membership ended, and no other identity
     * is acting in the browser. The drafts are keyed by this person's user
     * id, so the only one who can be offered them is this person signing back
     * in — and if somebody else signs in instead, the composer's mount sweep
     * (`sweepForeignDrafts`) removes them then. Clearing here would turn an
     * expired cookie into lost text, which is the one thing the composer
     * promises cannot happen. `context_mismatch` still clears: a different
     * identity is already acting in this browser.
     *
     * Clearing is idempotent, so a `context_mismatch` that arrives after an
     * `unauthorized` has already finished the store still clears.
     *
     * Clearing is not a tombstone either: another open tab of the same person
     * that holds words typed in it writes them back when their slot goes
     * (lib/journal/drafts.ts, `clearDraftsFor`). They stay keyed to this
     * identity, are never offered to anybody else, and the next mount by
     * another identity sweeps them.
     */
    function finishIdentity(options: { keepDrafts?: boolean } = {}): void {
      if (!options.keepDrafts) {
        const { workspace } = get()
        clearDraftsFor(workspace.organization.id, workspace.viewer.userId, draftStorage, draftSession)
      }
      if (!get().identityChanged) set({ identityChanged: true })
    }

    /**
     * Fire a write without blocking the caller, recording any failure.
     * Deliberately not awaited — the optimistic update has already landed.
     *
     * `recordId` is the collection name and row id this write touches, when it
     * touches exactly one row — pass `null` for anything else (a positional
     * reorder that persists several rows one call each already passes each
     * row's own id; a join-table link/unlink degrades gracefully to the coarse
     * `pendingWrites` guard since it has no single `id`).
     *
     * `successMessage` is opt-in: most callers pass `undefined` because the
     * action already shows its own feedback (a drag's motion, a checkbox's
     * chime and strike) and a toast on top would just be noise. Pass a
     * message only for a write with nothing else confirming it landed — a
     * create, a delete, a form save.
     */
    function persist(
      label: string,
      recordId: { collection: string; id: string } | null,
      run: () => Promise<ActionResult>,
      successMessage?: string
    ): void {
      pendingWrites += 1
      writeQueue = writeQueue
        .then(run)
        .then((result) => {
          if (!result.ok) {
            // The server answered as someone else: the session this tab was
            // built on is gone and another has replaced it. The write was
            // refused before it touched anything (see run() in the actions),
            // and this store must not submit again — reload instead of toast.
            if (result.error === CONTEXT_MISMATCH) {
              finishIdentity()
              return
            }
            pushToast('error', `${label} — ${result.error}`)
            return
          }
          // Only a successful write earns protection — a failed one has
          // nothing on the server to defend, and holding the optimistic row
          // in place would hide the failure instead of letting the next
          // merge quietly correct it.
          if (recordId) markRecent(recordId.collection, recordId.id)
          if (successMessage) pushToast('success', successMessage)
        })
        // Swallow here so one failed write does not poison every write after it.
        .catch((cause: unknown) => {
          const message = cause instanceof Error ? cause.message : String(cause)
          console.error(`[khyte] ${label} failed:`, message)
          pushToast('error', `${label} — ${message}`)
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

    /* ———— Journal ———— */

    /** A view nobody has read yet. */
    function emptyView(): JournalViewState {
      return { ids: [], nextCursor: null, coverage: null, status: 'idle' }
    }

    /** Replaces fields on one view, leaving the rest of the slice alone. */
    function patchView(key: string, patch: Partial<JournalViewState>): void {
      set((state) => ({
        journal: {
          ...state.journal,
          views: { ...state.journal.views, [key]: { ...(state.journal.views[key] ?? emptyView()), ...patch } },
        },
      }))
    }

    /** Files entries into the one map they are held in. Overwrites by id —
     *  a later read of the same entry is the fresher wording. */
    function fileEntries(entries: JournalEntryView[]): void {
      if (entries.length === 0) return
      set((state) => {
        const next = { ...state.journal.entries }
        for (const entry of entries) next[entry.id] = entry
        return { journal: { ...state.journal, entries: next } }
      })
    }

    /**
     * Does this entry belong in this view?
     *
     * The same question the server's `targets` filter answers, asked locally
     * so a just-written entry appears on the right feeds without a round-trip.
     * A view with no targets is a global feed and takes everything; a view
     * with targets takes an entry sharing at least one of them, which is the
     * any-of rule listEntries uses. `origins` is honoured for the same reason.
     */
    function viewAccepts(view: JournalViewState, entry: JournalEntryView): boolean {
      if (view.origins && !view.origins.includes(entry.origin)) return false
      if (!view.targets || view.targets.length === 0) return true
      return view.targets.some((target) =>
        entry.links.some((link) => link.targetType === target.type && link.targetId === target.id)
      )
    }

    /**
     * Puts a freshly written entry at the top of every list it belongs on.
     *
     * `surface` is the composer that produced it. A prospect drawer's composer
     * links the opportunity, so the prospect's own view would accept it
     * anyway; naming the surface means it lands there even if the view was
     * loaded with a filter the new links do not obviously satisfy — the writer
     * must see their own sentence appear in the box they typed it into.
     */
    function prependEntry(entry: JournalEntryView, surface?: string): void {
      fileEntries([entry])
      set((state) => {
        const views: Record<string, JournalViewState> = {}
        for (const [key, view] of Object.entries(state.journal.views)) {
          const belongs = key === surface || viewAccepts(view, entry)
          if (!belongs || view.ids.includes(entry.id)) {
            views[key] = view
            continue
          }
          views[key] = {
            ...view,
            ids: [entry.id, ...view.ids],
            // The list grew, so the count of it grows too. Without this the
            // feed's own line reads "Showing 5" over six cards the moment
            // somebody writes one — the coverage would still be describing
            // the page that was read before the write.
            coverage: view.coverage
              ? { ...view.coverage, returned: view.coverage.returned + 1 }
              : view.coverage,
          }
        }
        return { journal: { ...state.journal, views } }
      })
    }

    /**
     * What a refused Journal call means.
     *
     * `context_mismatch` is the store being finished, exactly as in persist();
     * everything else is reported and handed back so the caller can decide
     * what to do with it — the composer keeps its draft, the card shows the
     * conflict, the feed shows an error state.
     */
    function journalRefused(error: string): void {
      // `unauthorized` is the same conclusion reached from the other side:
      // the session or the membership ended, so nothing this store submits
      // can succeed as the identity it was built for. Same reload — but the
      // drafts stay, because nobody else is here to be offered them.
      if (error === UNAUTHORIZED) finishIdentity({ keepDrafts: true })
      else if (isIdentityRefusal(error)) finishIdentity()
    }

    /**
     * Awaits a Journal Server Action, turning a REJECTION into a refusal.
     *
     * A Server Action answers `{ ok: false, error }` for everything it can
     * see — a missing row, a stale revision, no database. It REJECTS for
     * everything it cannot: the browser is offline, the route returned a 500,
     * a deploy rotated the action id this bundle holds, `requireAuth()` threw
     * on a session that expired between the page load and the click. Nothing
     * below distinguishes the two cases, and it must not have to: an entry
     * that is deleted on screen because the network dropped is gone as far as
     * the person who deleted it is concerned.
     *
     * So the cause is reported the way persist() reports one — console, with
     * the label — and handed back in the shape every caller here already
     * branches on, which is what puts a rejection through the same restore,
     * the same toast and the same error state a refusal goes through.
     */
    async function journalCall<T>(
      label: string,
      run: () => Promise<T>
    ): Promise<T | { ok: false; error: string }> {
      try {
        return await run()
      } catch (cause: unknown) {
        const message = cause instanceof Error ? cause.message : String(cause)
        console.error(`[khyte] ${label} failed:`, message)
        return { ok: false, error: message }
      }
    }

    /**
     * Reads the first page of a view and makes it the list.
     *
     * An explicit read — a feed mounting, a Refresh press — is somebody
     * asking for the newest page, and that is what the newest page is: the
     * list is replaced, pages loaded before it included. The poller does not
     * come through here; it re-reads the whole range a reader holds, in
     * `refreshRange`.
     */
    async function readFirstPage(
      key: string,
      options: { targets?: LinkTarget[]; origins?: JournalOrigin[]; limit?: number } | undefined
    ): Promise<void> {
      const existing = get().journal.views[key]
      const targets = options?.targets ?? existing?.targets
      const origins = options?.origins ?? existing?.origins
      if (options?.limit !== undefined) journalLimits.set(key, options.limit)
      const limit = journalLimits.get(key)

      // The previous page stays on screen while the new one is read. A feed
      // that empties itself to show a spinner loses the reader's place on
      // every refresh, and a refresh happens every time the poller sees the
      // stamp move.
      patchView(key, { status: 'loading', error: undefined, targets, origins })

      const result = await journalCall('Read the Journal', () =>
        journalApi.loadJournalPage(
          { targets, origins, ...(limit === undefined ? {} : { limit }) },
          scope()
        )
      )
      if (!result.ok) {
        // Whatever went wrong, `loading` has to come off: Refresh and Load
        // more are both disabled while it is set, so a read that failed and
        // left it behind takes the feed's two controls with it.
        journalRefused(result.error)
        patchView(key, { status: 'error', error: result.error })
        return
      }
      fileEntries(result.page.entries)
      journalPages.set(key, 1)
      patchView(key, {
        ids: result.page.entries.map((entry) => entry.id),
        nextCursor: result.page.nextCursor,
        coverage: result.page.coverage,
        status: 'idle',
        error: undefined,
        targets,
        origins,
      })
    }

    /**
     * Re-reads everything a view is holding and makes that the list — the
     * poller's read.
     *
     * The first-page merge this replaces kept the reader's pages but could
     * only ever ADD to them: an entry a colleague deleted on page two stayed
     * on screen with its text, and an edit to it never arrived, because
     * nothing ever read page two again. So the whole loaded range is read
     * again — the first page without a cursor, then `nextCursor` for as many
     * pages as the view holds — and the answer REPLACES the ids. What the
     * reads no longer return has been deleted, or no longer matches the
     * filter, and leaves the view, and the entries map too when no other view
     * holds it; what they do return is rewritten, which is how an edit
     * reaches a card on page three.
     *
     * WITHOUT TRUNCATING THE RANGE. Entries written at the top push the rest
     * down, so the same number of pages now ends earlier than it did, and the
     * entry at the bottom of the reader's list — possibly the one being read —
     * would fall off it. The walk therefore continues past the page count
     * until it reaches that entry's position, bounded at twice the pages held
     * so a burst of writes cannot turn one poll into an unbounded read.
     * `nextCursor` and `hasMore` are the last page's: they describe the tail
     * this read reached. A one-page view reads one page, as an explicit read
     * would — the dashboard's five newest are five, not six.
     *
     * The reader's place is kept by id continuity: every card still in the
     * Journal keeps its key, so React keeps its node and nothing moves except
     * by the height of what arrived above it.
     *
     * Writes made on this screen WHILE the read was in flight are not undone
     * by it. An id filed into the view since the walk started (a composer's
     * save, the drawer's next-step line) is kept at the top, and an id taken
     * out of it since (an optimistic delete) is not put back by pages read
     * before the delete landed.
     *
     * Returns false when a read failed, which leaves the view in error and
     * the list as it was.
     */
    async function refreshRange(key: string): Promise<boolean> {
      const view = get().journal.views[key]
      if (!view) return true
      const pages = Math.max(1, journalPages.get(key) ?? 1)
      const ceiling = pages > 1 ? pages * 2 : 1
      const { targets, origins } = view
      const limit = journalLimits.get(key)
      const heldAtStart = new Set(view.ids)
      const tailId = view.ids.at(-1)
      const tail = tailId ? get().journal.entries[tailId] : undefined

      patchView(key, { status: 'loading', error: undefined })

      const fresh: JournalEntryView[] = []
      const got = new Set<string>()
      let cursor: string | null = null
      let last: JournalPage | null = null
      let read = 0
      do {
        const after: string | null = cursor
        const result: JournalPageActionResult = await journalCall('Read the Journal', () =>
          journalApi.loadJournalPage(
            {
              targets,
              origins,
              ...(after ? { cursor: after } : {}),
              ...(limit === undefined ? {} : { limit }),
            },
            scope()
          )
        )
        if (!result.ok) {
          journalRefused(result.error)
          patchView(key, { status: 'error', error: result.error })
          return false
        }
        read += 1
        last = result.page
        // Deduplicated across pages: an entry written between two reads
        // shifts the keyset window and can arrive twice.
        for (const entry of result.page.entries) {
          if (got.has(entry.id)) continue
          got.add(entry.id)
          fresh.push(entry)
        }
        cursor = result.page.nextCursor
      } while (cursor && read < ceiling && (read < pages || !reachedTail(fresh, tailId, tail)))

      const page = last
      if (!page) return true
      set((state) => {
        const current = state.journal.views[key] ?? emptyView()
        const still = new Set(current.ids)
        const arrived = current.ids.filter((id) => !heldAtStart.has(id) && !got.has(id))
        const removedHere = (id: string) => heldAtStart.has(id) && !still.has(id)
        const ids = [...arrived, ...fresh.map((entry) => entry.id).filter((id) => !removedHere(id))]
        const kept = new Set(ids)

        const views: Record<string, JournalViewState> = {
          ...state.journal.views,
          [key]: {
            ...current,
            ids,
            nextCursor: page.nextCursor,
            // Accumulated: `returned` counts the list, the rest describes the
            // tail — the same rule Load more follows.
            coverage: { ...page.coverage, returned: ids.length },
            status: 'idle',
            error: undefined,
          },
        }

        const entries = { ...state.journal.entries }
        for (const entry of fresh) {
          if (kept.has(entry.id)) entries[entry.id] = entry
        }
        for (const id of current.ids) {
          if (kept.has(id)) continue
          const heldElsewhere = Object.entries(views).some(
            ([other, otherView]) => other !== key && otherView.ids.includes(id)
          )
          if (!heldElsewhere) delete entries[id]
        }
        return { journal: { entries, views } }
      })
      journalPages.set(key, read)
      return true
    }

    /**
     * Reads one entry again and files it — after `revision_conflict`, so the
     * card holding an editor learns the revision it lost to. Silent on
     * failure: the card already says the entry moved, and the next poll reads
     * it anyway.
     */
    async function refetchEntry(id: string): Promise<void> {
      const result = await journalCall('Read the Journal', () => journalApi.loadJournalEntry(id, scope()))
      if (!result.ok) {
        journalRefused(result.error)
        return
      }
      // A detail carries the original text and every revision; the one copy
      // the feeds render is the view, and nothing else belongs in it.
      const { originalText: _original, revisions: _revisions, ...view } = result.entry
      fileEntries([view])
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
      workspace: snapshot.workspace,
      companies: snapshot.companies,
      contacts: snapshot.contacts,
      opportunities: snapshot.opportunities,
      leads: snapshot.leads,
      strategyBoards: snapshot.strategyBoards,
      strategyBoardOpportunities: snapshot.strategyBoardOpportunities,
      strategyColumns: snapshot.strategyColumns,
      strategyCards: snapshot.strategyCards,
      tasks: snapshot.tasks,

      // The Journal starts empty on every page load: it is read per surface,
      // a page at a time, not shipped with the working set.
      journal: { entries: {}, views: {} },
      journalTyping: false,

      // Sync state
      toasts: [],
      identityChanged: false,
      markIdentityChanged: (reason) => finishIdentity({ keepDrafts: reason === UNAUTHORIZED }),

      dismissToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

      applyRemoteSnapshot: (snapshot) => {
        // Not ours. A snapshot for another organization, or for another
        // person in this one, is the working set of whoever is now logged in
        // — the cookie changed underneath this tab. Merging it would put two
        // workspaces in one store, and the grace window would even keep this
        // one's recent rows alive inside the other's roster. Refuse, and mark
        // the store finished; SnapshotSync reloads the page.
        const { workspace } = get()
        if (
          snapshot.workspace.organization.id !== workspace.organization.id ||
          snapshot.workspace.viewer.userId !== workspace.viewer.userId
        ) {
          finishIdentity()
          return false
        }

        // A write of our own is still in the air. The snapshot on the wire was
        // read before it landed, so applying it now would visibly undo the
        // change the user just made. Refusing is cheap — the poll comes back.
        if (pendingWrites > 0) return false

        // Mid-drag, or any other interaction that holds a reference to a row
        // it is moving. Rebuilding the collections underneath it is how a card
        // ends up dropped into a column that no longer exists.
        if (syncPauseDepth > 0) return false

        // Only the data collections. Settings, sidebar, search query and
        // toasts belong to this browser, not to the database, and a merge
        // that reset the user's filters every time a colleague saved something
        // would be worse than no sync at all.
        //
        // Per-record, not a wholesale swap: `pendingWrites` above only catches
        // a write still in flight. One that already settled can still lose to
        // a poll whose read started before it committed, and a blind overwrite
        // here would silently revert that write on screen with nothing to
        // explain why — see markRecent/mergeCollection.
        const state = get()
        set({
          // Merged per member, like the collections: a poll that started
          // before a member action committed must not undo it. The viewer is
          // re-derived from the merged roster, which is how a rename or a
          // demotion by another owner reaches the chrome too.
          workspace: mergeWorkspace(state.workspace, snapshot.workspace),
          companies: mergeCollection('companies', state.companies, snapshot.companies),
          contacts: mergeCollection('contacts', state.contacts, snapshot.contacts),
          opportunities: mergeCollection('opportunities', state.opportunities, snapshot.opportunities),
          leads: mergeCollection('leads', state.leads, snapshot.leads),
          strategyBoards: mergeCollection('strategyBoards', state.strategyBoards, snapshot.strategyBoards),
          // No single `id` to key protection on — falls back to whatever
          // pendingWrites already caught, same as before this change.
          strategyBoardOpportunities: snapshot.strategyBoardOpportunities,
          strategyColumns: mergeCollection('strategyColumns', state.strategyColumns, snapshot.strategyColumns),
          strategyCards: mergeCollection('strategyCards', state.strategyCards, snapshot.strategyCards),
          tasks: mergeCollection('tasks', state.tasks, snapshot.tasks),
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
        persist(
          'Save lead',
          { collection: 'opportunities', id: placed.id },
          () => api.createOpportunity(placed, scope()),
          'Prospect created'
        )
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
        persist('Add to pipeline', { collection: 'opportunities', id: opportunityId }, () =>
          api.updateOpportunity(opportunityId, { inPipeline: true, stage, order }, scope())
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
          persist('Move stage', { collection: 'opportunities', id: o.id }, () =>
            api.updateOpportunity(o.id, { stage: o.stage, order: o.order }, scope())
          )
        }
      },

      updateOpportunity: (opportunityId, updates) => {
        set((state) => ({
          opportunities: state.opportunities.map((o) =>
            o.id === opportunityId ? { ...o, ...updates } : o
          ),
        }))
        persist('Update lead', { collection: 'opportunities', id: opportunityId }, () =>
          api.updateOpportunity(opportunityId, updates, scope())
        )
      },

      // A strategy board can now be shared by more than one prospect, so this
      // opportunity's board(s) only disappear locally when it was the LAST
      // prospect linked to them — mirrors the server-side cleanup in
      // deleteOpportunity (app/actions/crm.ts), which must reach the same
      // conclusion or a shared board would flicker in and out on the next poll.
      removeOpportunity: (opportunityId) => {
        set((state) => {
          const linkedBoardIds = state.strategyBoardOpportunities
            .filter((l) => l.opportunityId === opportunityId)
            .map((l) => l.boardId)
          const remainingLinks = state.strategyBoardOpportunities.filter(
            (l) => l.opportunityId !== opportunityId
          )
          const orphanedBoardIds = new Set(
            linkedBoardIds.filter(
              (boardId) => !remainingLinks.some((l) => l.boardId === boardId)
            )
          )
          const orphanedColumnIds = new Set(
            state.strategyColumns
              .filter((k) => orphanedBoardIds.has(k.boardId))
              .map((k) => k.id)
          )

          return {
            // Journal entries are NOT pruned here. Deleting a prospect
            // tombstones its links and keeps the entries (decision 3) — what
            // somebody wrote about a company survives the CRM row it was
            // filed against. The next read of any open feed shows them with a
            // muted, "removed" chip; nothing local has to be swept.
            opportunities: state.opportunities.filter((o) => o.id !== opportunityId),
            strategyBoardOpportunities: remainingLinks,
            strategyBoards: state.strategyBoards.filter((b) => !orphanedBoardIds.has(b.id)),
            strategyColumns: state.strategyColumns.filter(
              (k) => !orphanedBoardIds.has(k.boardId)
            ),
            strategyCards: state.strategyCards.filter(
              (c) => !orphanedColumnIds.has(c.columnId)
            ),
          }
        })
        persist(
          'Delete prospect',
          null,
          () => api.deleteOpportunity(opportunityId, scope()),
          'Prospect deleted'
        )
      },

      // Journal
      setJournalTyping: (typing) => set({ journalTyping: typing }),

      // Somebody asked for this list, so this list is what they get: the
      // newest page, replacing whatever was held. The poller's own read is
      // the one that keeps a reader's pages — see `refreshRange`.
      loadJournalView: async (key, options) => readFirstPage(key, options),

      acquireJournalView: (key) => {
        journalRefs.set(key, (journalRefs.get(key) ?? 0) + 1)
      },

      releaseJournalView: (key) => {
        const remaining = (journalRefs.get(key) ?? 0) - 1
        if (remaining > 0) {
          journalRefs.set(key, remaining)
          return
        }
        journalRefs.delete(key)
        journalLimits.delete(key)
        journalPages.delete(key)
        // The VIEW goes; the entries do not. They are one normalized copy
        // each, they are what another view already on screen is rendering,
        // and keeping them means reopening this drawer shows its lines
        // immediately and then refreshes rather than starting from a
        // skeleton. What had to stop is the poller re-reading a feed nobody
        // has been looking at since three navigations ago.
        set((state) => {
          if (!(key in state.journal.views)) return {}
          const views = { ...state.journal.views }
          delete views[key]
          return { journal: { ...state.journal, views } }
        })
      },

      loadMoreJournal: async (key) => {
        const view = get().journal.views[key]
        if (!view?.nextCursor || view.status === 'loading') return
        const limit = journalLimits.get(key)
        patchView(key, { status: 'loading', error: undefined })

        const result = await journalCall('Read the Journal', () =>
          journalApi.loadJournalPage(
            { targets: view.targets, origins: view.origins, cursor: view.nextCursor, ...(limit === undefined ? {} : { limit }) },
            scope()
          )
        )
        if (!result.ok) {
          journalRefused(result.error)
          patchView(key, { status: 'error', error: result.error })
          return
        }
        fileEntries(result.page.entries)
        // Deduplicated on append: an entry written between the two reads
        // shifts the keyset window, and the same id arriving twice would
        // render twice and break React's keys.
        const held = get().journal.views[key]?.ids ?? []
        const seen = new Set(held)
        const added = result.page.entries.map((entry) => entry.id).filter((id) => !seen.has(id))
        const previous = get().journal.views[key]?.coverage
        journalPages.set(key, (journalPages.get(key) ?? 1) + 1)
        patchView(key, {
          ids: [...held, ...added],
          nextCursor: result.page.nextCursor,
          // Coverage after a Load more is about BOTH pages. `hasMore`,
          // `loadedAt` and `oldestCreatedAt` come from the newest read —
          // they describe the tail, which is what the newest read reached —
          // but `returned` is a count of the list, and the list is now every
          // page held. Taking the new page's count wholesale is what made
          // the feed say "Showing 10" over seventy cards.
          coverage: {
            ...result.page.coverage,
            returned: (previous?.returned ?? held.length) + added.length,
          },
          status: 'idle',
          error: undefined,
        })
      },

      refreshJournalViews: async () => {
        // Somebody is mid-sentence. Re-rendering the feed under a composer is
        // worse than being a few seconds behind — but the change is NOT
        // consumed: 'deferred' tells the poller to keep the stamp pending and
        // ask again, so it appears once the typing stops.
        if (get().journalTyping) return 'deferred'
        // Only the feeds somebody is actually looking at. A view with no live
        // reference belongs to a drawer that was closed or a page that was
        // navigated away from, and re-reading it is a database round-trip
        // nobody will see the result of.
        const keys = Object.keys(get().journal.views).filter(
          (key) => (journalRefs.get(key) ?? 0) > 0
        )
        // In parallel: three feeds on a dashboard are three independent reads,
        // and a serial loop made the last one wait for the first two.
        const applied = await Promise.all(keys.map((key) => refreshRange(key)))
        return applied.every(Boolean) ? 'applied' : 'failed'
      },

      submitCapture: async (input, options) => {
        // The composer's context is folded in here rather than trusted to
        // every caller: a drawer composer that forgot its link would file an
        // entry against nothing, and the prospect it was typed into would not
        // show it. An input that names its own links wins — a caller with
        // something specific to say is not overruled by the surface.
        const links = input.links?.length ? input.links : options.context?.links ?? []
        const result = await journalCall('Save entry', () =>
          journalApi.createJournalEntry({ ...input, links }, scope())
        )

        if (!result.ok) {
          // `context_mismatch` or `unauthorized` means this tab is finished —
          // the same conclusion persist() reaches, and SnapshotSync turns it
          // into a reload. Nothing is toasted for it: the page is about to go.
          if (isIdentityRefusal(result.error)) {
            journalRefused(result.error)
            return result
          }
          // `request_key_conflict` and `unavailable` are the composer's to
          // explain in its own words, in place, next to the text they concern.
          if (result.error !== 'request_key_conflict' && result.error !== 'unavailable') {
            pushToast('error', `Save entry — ${result.error}`)
          }
          return result
        }

        // THE DRAFT IS NOT CLEARED HERE. The composer owns it and clears it on
        // exactly this result — see lib/journal/drafts.ts on why a draft that
        // outlives a failed save is the whole point.
        prependEntry(result.entry, options.surface)
        return result
      },

      editJournalEntry: async (id, patch) => {
        const result = await journalCall('Save entry', () =>
          journalApi.editJournalEntry(id, patch, scope())
        )
        if (!result.ok) {
          journalRefused(result.error)
          // The card offers "use the latest version as the base", which is
          // only an offer if the store holds the latest version. The poller
          // cannot be relied on to bring it — it is held while the editor has
          // focus — so it is read here, before the card hears the answer.
          if (result.error === 'revision_conflict') await refetchEntry(id)
          // `revision_conflict`, `deleted`, `not_found` and `system_entry` are
          // answers, not faults: the card says what happened and offers the
          // way forward. An identity refusal is the page reloading. Anything
          // else is a failure worth a toast.
          if (
            result.error !== 'revision_conflict' &&
            result.error !== 'deleted' &&
            result.error !== 'not_found' &&
            result.error !== 'system_entry' &&
            !isIdentityRefusal(result.error)
          ) {
            pushToast('error', `Save entry — ${result.error}`)
          }
          return result
        }
        // Written once, into the one copy every view renders — which is what
        // keeps the drawer and /journal from disagreeing about the wording.
        fileEntries([result.entry])
        return result
      },

      deleteJournalEntry: async (id) => {
        const removed = get().journal.entries[id]
        const removedFrom: Record<string, number> = {}
        set((state) => {
          const entries = { ...state.journal.entries }
          delete entries[id]
          const views: Record<string, JournalViewState> = {}
          for (const [key, view] of Object.entries(state.journal.views)) {
            const at = view.ids.indexOf(id)
            if (at === -1) {
              views[key] = view
              continue
            }
            removedFrom[key] = at
            views[key] = {
              ...view,
              ids: view.ids.filter((entryId) => entryId !== id),
              // Same rule as prependEntry's: the count describes the list.
              coverage: view.coverage
                ? { ...view.coverage, returned: Math.max(0, view.coverage.returned - 1) }
                : view.coverage,
            }
          }
          return { journal: { entries, views } }
        })

        const result = await journalCall('Delete entry', () =>
          journalApi.deleteJournalEntry(id, scope())
        )
        if (!result.ok) {
          journalRefused(result.error)
          // Put it back where it was. Unlike the CRM collections — where a
          // failed write is left on screen for the next merge to correct —
          // nothing re-reads the Journal on its own promptly enough, and an
          // entry that vanished because a delete failed is an entry the writer
          // believes is gone.
          if (removed) {
            set((state) => {
              const views: Record<string, JournalViewState> = { ...state.journal.views }
              for (const [key, at] of Object.entries(removedFrom)) {
                const view = views[key]
                if (!view || view.ids.includes(id)) continue
                const ids = [...view.ids]
                ids.splice(Math.min(at, ids.length), 0, id)
                views[key] = {
                  ...view,
                  ids,
                  coverage: view.coverage
                    ? { ...view.coverage, returned: view.coverage.returned + 1 }
                    : view.coverage,
                }
              }
              return { journal: { entries: { ...state.journal.entries, [id]: removed }, views } }
            })
          }
          // The card says the rest in place; an identity refusal is the page
          // reloading, and a toast over it would be noise.
          if (!isIdentityRefusal(result.error)) pushToast('error', `Delete entry — ${result.error}`)
        }
        return result
      },

      changeNextStep: async (opportunityId, next) => {
        const before = get().opportunities.find((o) => o.id === opportunityId)
        if (!before) return { ok: false, error: 'not_found' }
        const previous = before.nextStep
        if (previous === next) return { ok: true, entry: null, previous }

        // The field moves now, like every other drawer field.
        set((state) => ({
          opportunities: state.opportunities.map((o) =>
            o.id === opportunityId ? { ...o, nextStep: next } : o
          ),
        }))

        // Through the write queue and counted as pending, exactly as persist()
        // does for the CRM half. Queued, because this is a write to the
        // opportunity row and must land after the create or the stage change
        // fired just before it; counted, because a snapshot read while it is
        // in the air does not contain it and merging that read would put the
        // old next step back on screen. `journalCall` never rejects, so the
        // queue cannot be poisoned by it.
        pendingWrites += 1
        const run = writeQueue.then(() =>
          journalCall('Update next step', () => journalApi.changeNextStep(opportunityId, next, scope()))
        )
        writeQueue = run
        let result: NextStepActionResult
        try {
          result = await run
        } finally {
          pendingWrites -= 1
          if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('khyte:crm-write'))
        }

        if (!result.ok) {
          journalRefused(result.error)
          // No database behind this deployment (demo mode). Every other CRM
          // write there succeeds on the in-memory working set without going
          // anywhere, and the old path did the same for this field; restoring
          // it would make the next step the one field demo mode cannot edit.
          if (result.error === 'unavailable') return result
          // Put the previous value back — unless the field has moved again
          // since, in which case that later change is the one on screen and
          // this answer has nothing to say about it.
          set((state) => ({
            opportunities: state.opportunities.map((o) =>
              o.id === opportunityId && o.nextStep === next ? { ...o, nextStep: previous } : o
            ),
          }))
          if (!isIdentityRefusal(result.error)) pushToast('error', `Update next step — ${result.error}`)
          return result
        }

        // The same protection persist() gives a settled write: a poll whose
        // read started before this committed must not revert it.
        markRecent('opportunities', opportunityId)
        // Filed through the same rule a typed entry uses, naming the prospect's
        // own view: the line is about this prospect, and it is also a Journal
        // entry like any other, so a global feed already on screen shows it too
        // rather than contradicting the drawer until the next poll.
        if (result.entry) prependEntry(result.entry, `prospect:${opportunityId}`)
        return result
      },

      // Strategy
      createStrategyBoard: (board) => {
        set((state) => ({ strategyBoards: [...state.strategyBoards, board] }))
        persist('Create board', { collection: 'strategyBoards', id: board.id }, () =>
          api.createStrategyBoard(board, scope())
        )
      },

      linkOpportunityToBoard: (boardId, opportunityId) => {
        set((state) =>
          state.strategyBoardOpportunities.some(
            (l) => l.boardId === boardId && l.opportunityId === opportunityId
          )
            ? state
            : {
                strategyBoardOpportunities: [
                  ...state.strategyBoardOpportunities,
                  { boardId, opportunityId },
                ],
              }
        )
        persist('Link prospect', null, () =>
          api.linkOpportunityToBoard(boardId, opportunityId, scope())
        )
      },

      unlinkOpportunityFromBoard: (boardId, opportunityId) => {
        set((state) => ({
          strategyBoardOpportunities: state.strategyBoardOpportunities.filter(
            (l) => !(l.boardId === boardId && l.opportunityId === opportunityId)
          ),
        }))
        persist('Unlink prospect', null, () =>
          api.unlinkOpportunityFromBoard(boardId, opportunityId, scope())
        )
      },

      addStrategyColumn: (column) => {
        set((state) => ({ strategyColumns: [...state.strategyColumns, column] }))
        persist('Save headline', { collection: 'strategyColumns', id: column.id }, () =>
          api.createStrategyColumn(column, scope())
        )
      },

      renameStrategyColumn: (columnId, title) => {
        set((state) => ({
          strategyColumns: state.strategyColumns.map((k) =>
            k.id === columnId ? { ...k, title } : k
          ),
        }))
        persist('Rename headline', { collection: 'strategyColumns', id: columnId }, () =>
          api.updateStrategyColumn(columnId, { title }, scope())
        )
      },

      removeStrategyColumn: (columnId) => {
        // The database cascades the cards; the local set has to be pruned by
        // hand or they would linger as cards with no lane to render in.
        set((state) => ({
          strategyColumns: state.strategyColumns.filter((k) => k.id !== columnId),
          strategyCards: state.strategyCards.filter((c) => c.columnId !== columnId),
        }))
        persist('Delete headline', null, () => api.deleteStrategyColumn(columnId, scope()))
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
          persist('Move strategy card', { collection: 'strategyCards', id: c.id }, () =>
            api.updateStrategyCard(c.id, { columnId: c.columnId, order: c.order }, scope())
          )
        }
      },

      addStrategyCard: (card) => {
        set((state) => ({ strategyCards: [...state.strategyCards, card] }))
        persist('Save strategy card', { collection: 'strategyCards', id: card.id }, () =>
          api.createStrategyCard(card, scope())
        )
      },

      editStrategyCard: (cardId, content) => {
        set((state) => ({
          strategyCards: state.strategyCards.map((c) =>
            c.id === cardId ? { ...c, content } : c
          ),
        }))
        persist('Edit strategy card', { collection: 'strategyCards', id: cardId }, () =>
          api.updateStrategyCard(cardId, { content }, scope())
        )
      },

      removeStrategyCard: (cardId) => {
        const card = get().strategyCards.find((c) => c.id === cardId)
        if (!card) return

        // Same dense 0..n-1 reindex moveStrategyCard keeps the lane in —
        // removing the middle card of three must not leave orders 0 and 2
        // with a gap, or the next drag into this lane inherits it.
        const remainingInLane = get()
          .strategyCards.filter((c) => c.columnId === card.columnId && c.id !== cardId)
          .sort((a, b) => a.order - b.order)
          .map((c, order) => ({ ...c, order }))
        const byId = new Map(remainingInLane.map((c) => [c.id, c]))

        set((state) => ({
          strategyCards: state.strategyCards
            .filter((c) => c.id !== cardId)
            .map((c) => byId.get(c.id) ?? c),
        }))

        persist('Delete strategy card', null, () => api.deleteStrategyCard(cardId, scope()))
        for (const c of remainingInLane) {
          persist('Reorder strategy card', { collection: 'strategyCards', id: c.id }, () =>
            api.updateStrategyCard(c.id, { order: c.order }, scope())
          )
        }
      },

      // Tasks
      addTask: (task) => {
        // `order` belongs to the store, not the caller: a new task goes to the
        // front of its bucket, so one below the lowest order already in it (0
        // when the bucket is empty, giving -1). Siblings are left alone — the
        // board only reads the relative order, and moveTask re-densifies the
        // bucket to 0..n-1 on the first drag, same as it does for every drag.
        const lowest = get().tasks.reduce(
          (min, t) =>
            t.completed === task.completed && !t.archivedAt ? Math.min(min, t.order) : min,
          0
        )
        const created: Task = { ...task, order: lowest - 1 }

        set((state) => ({ tasks: [created, ...state.tasks] }))
        persist(
          'Save task',
          { collection: 'tasks', id: created.id },
          () => api.createTask(created, scope()),
          'Task created'
        )
      },

      // Routes through moveTask (filing the task at the end of its new
      // bucket) rather than just flipping `completed` in place — the board
      // now sorts each column by `order`, and leaving it unchanged here
      // would let the task land on top of whichever task already holds that
      // order in the bucket it just joined.
      toggleTaskComplete: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId)
        if (!task) return
        get().moveTask(taskId, !task.completed)
      },

      updateTask: (taskId, updates) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, ...updates } : t
          ),
        }))
        persist(
          'Update task',
          { collection: 'tasks', id: taskId },
          () => api.updateTask(taskId, updates, scope()),
          'Task saved'
        )
      },

      moveTask: (taskId, completed, targetIndex) => {
        const task = get().tasks.find((t) => t.id === taskId)
        if (!task) return

        // Rebuild the destination bucket (open vs. done, archived excluded)
        // around the drop so `order` stays a dense 0..n-1 sequence — same
        // reasoning as moveStrategyCard.
        const bucket = get()
          .tasks.filter(
            (t) => t.completed === completed && !t.archivedAt && t.id !== taskId
          )
          .sort((a, b) => a.order - b.order)
        bucket.splice(targetIndex ?? bucket.length, 0, { ...task, completed })

        const moved = bucket
          .map((t, order) =>
            t.order === order && t.completed === completed && t.id !== taskId
              ? null
              : { ...t, completed, order }
          )
          .filter((t): t is Task => t !== null)
        const byId = new Map(moved.map((t) => [t.id, t]))

        set((state) => ({
          tasks: state.tasks.map((t) => byId.get(t.id) ?? t),
        }))

        for (const t of moved) {
          persist('Move task', { collection: 'tasks', id: t.id }, () =>
            api.updateTask(t.id, { completed: t.completed, order: t.order }, scope())
          )
        }
      },

      archiveTask: (taskId, archived = true) => {
        const archivedAt = archived ? new Date().toISOString() : undefined
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, archivedAt } : t)),
        }))
        persist('Archive task', { collection: 'tasks', id: taskId }, () =>
          api.updateTask(taskId, { archivedAt }, scope())
        )
      },

      deleteTask: (taskId) => {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== taskId) }))
        persist('Delete task', null, () => api.deleteTask(taskId, scope()), 'Task deleted')
      },

      // Companies & Contacts
      addCompany: (company) => {
        set((state) => ({ companies: [...state.companies, company] }))
        persist(
          'Save company',
          { collection: 'companies', id: company.id },
          () => api.createCompany(company, scope()),
          'Company created'
        )
      },

      updateCompany: (companyId, updates) => {
        set((state) => ({
          companies: state.companies.map((c) =>
            c.id === companyId ? { ...c, ...updates } : c
          ),
        }))
        persist('Update company', { collection: 'companies', id: companyId }, () =>
          api.updateCompany(companyId, updates, scope())
        )
      },

      addContact: (contact) => {
        set((state) => ({ contacts: [...state.contacts, contact] }))
        persist(
          'Save contact',
          { collection: 'contacts', id: contact.id },
          () => api.createContact(contact, scope()),
          'Contact created'
        )
      },

      updateContact: (contactId, updates) => {
        set((state) => ({
          contacts: state.contacts.map((c) =>
            c.id === contactId ? { ...c, ...updates } : c
          ),
        }))
        persist('Update contact', { collection: 'contacts', id: contactId }, () =>
          api.updateContact(contactId, updates, scope())
        )
      },

      // Leads
      addLead: (lead) => {
        set((state) => ({ leads: [lead, ...state.leads] }))
        persist(
          'Save lead',
          { collection: 'leads', id: lead.id },
          () => api.createLead(lead, scope()),
          'Lead created'
        )
      },

      updateLead: (leadId, updates) => {
        set((state) => ({
          leads: state.leads.map((l) =>
            l.id === leadId ? { ...l, ...updates } : l
          ),
        }))
        persist('Update lead', { collection: 'leads', id: leadId }, () =>
          api.updateLead(leadId, updates, scope())
        )
      },

      removeLead: (leadId) => {
        set((state) => ({ leads: state.leads.filter((l) => l.id !== leadId) }))
        persist('Remove lead', null, () => api.deleteLead(leadId, scope()), 'Lead removed')
      },

      // Workspace
      setWorkspaceMembers: (members) =>
        set((state) => ({ workspace: { ...state.workspace, members } })),

      upsertWorkspaceMember: (member) =>
        set((state) => {
          // Same grace window as a settled write: a poll whose read predates
          // this row must not take it back — see mergeWorkspace.
          markRecent('members', member.id)
          const { workspace } = state
          const known = workspace.members.some((m) => m.id === member.id)
          const members = known
            ? workspace.members.map((m) => (m.id === member.id ? member : m))
            : [...workspace.members, member]

          // Same person as the one looking: keep the viewer in step. Matched
          // on userId rather than memberId so a re-added membership (same id,
          // see lib/org/members.addMember) and a fresh one behave alike.
          const viewer =
            member.userId === workspace.viewer.userId
              ? {
                  ...workspace.viewer,
                  displayName: member.displayName,
                  role: member.role,
                  colleague: member.colleague,
                }
              : workspace.viewer

          return { workspace: { ...workspace, members, viewer } }
        }),

      // UI
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setSearchQuery: (query) => set({ searchQuery: query }),
    }
  })
}
