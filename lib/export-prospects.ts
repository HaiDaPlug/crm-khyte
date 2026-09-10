import type {
  Company,
  Contact,
  CrmEventKind,
  Note,
  Opportunity,
  Stage,
  Task,
} from '@/lib/types'
import type { CrmEventRecord } from '@/lib/db/events'
import { STAGES } from '@/lib/stage-config'

/**
 * Exporting the companies we have already approached, so an AI building a
 * prospecting list can skip them.
 *
 * WHAT COUNTS AS CONTACTED. Stage rank at or past `Contacted` — the same bar
 * `crossedInto(from, to, 'Contacted')` uses in lib/db/events.ts, deliberately so
 * the export and the weekly outreach counter cannot disagree about what the word
 * means. Reading the stage rather than the event log matters here: the log
 * answers "how much outreach happened last week", which is a fact about a period,
 * while this answers "have we ever touched this company", which is a fact about
 * the company. A prospect contacted before the log existed has no event but is
 * still very much contacted.
 *
 * WHY `New` AND `Ongoing` ARE EXCLUDED. Only these two sit below the bar. Note
 * that this team files a prospect straight into `Contacted` after calling it
 * (see eventsForArrival), so the pre-contact stages are genuinely the untouched
 * ones rather than a backlog of already-called companies.
 *
 * WHY `Lost` IS INCLUDED. A lost deal is emphatically a company we have already
 * approached — omitting it is how a dedup list hands you back somebody you
 * already burned. It ships with its stage attached so the reader can still tell
 * a dead company from a live one.
 *
 * WHY THE FILE IS WIDE. The consumer is a language model asked to reason about
 * what has happened across the sample, not just to dedup a list. A snapshot of
 * eleven columns answers "who did we call"; it cannot answer "which of these
 * went quiet", "how long does a deal sit in Warm", or "is anybody overdue".
 * Every column below is either recorded fact or arithmetic over dates the store
 * already holds — see `docs/export-schema.md` for the column-by-column contract
 * to hand over alongside the file.
 *
 * THE EVENT LOG, AND WHY EVERY DATE FROM IT CARRIES ITS PROVENANCE. The real
 * dated history lives in `crm_events`, fetched by app/actions/export.ts and
 * passed in as `events`. It is emphatically not uniform, and a model handed only
 * the dates would treat three very different things as one:
 *
 *   observed   — a stage transition the CRM watched happen, dated when it did.
 *   logged     — the operator typed a contact date into the drawer afterwards.
 *   backfilled — reconstructed from the stage a prospect was already sitting in,
 *                dated by `lastInteraction`.
 *
 * The backfilled tier is the dangerous one: every kind reconstructed for a given
 * prospect shares a single date, so a backfilled "contacted" and "meeting
 * booked" landing on the same day is an artifact of the reconstruction, not a
 * same-day booking. `historyQuality` and the `*Source` columns exist so that is
 * legible rather than inferred wrongly.
 *
 * WHAT THE LOG STILL CANNOT SUPPORT, measured against the live data rather than
 * assumed: of 145 contacted prospects, 138 have events on exactly one day and 4
 * on two. Per-stage dwell time is therefore computable for a handful of records
 * and empty for the rest, which is why this exports `daysContactedToMeeting`
 * only where both dates are genuinely observed, and why there is no column
 * purporting to time every stage transition. An empty column that looks
 * computable is worse than an absent one — a model will average what it is
 * given.
 */

/** Stage order, by index in the canonical list — mirrors lib/db/events.ts. */
const stageRank = (stage: Stage): number => STAGES.indexOf(stage)

const CONTACTED_BAR = stageRank('Contacted')

/**
 * Where a stage sits relative to the deal being decided.
 *
 * Rank alone cannot express this, because `Lost` outranks `Won` positionally
 * while being its opposite in every other sense — the same quirk events.ts has
 * to special-case. Naming the three buckets means a model never has to infer
 * that from the ordering, and never has to guess whether `Lost` is "late-stage
 * progress".
 */
function stageStatus(stage: Stage): 'open' | 'won' | 'lost' {
  if (stage === 'Won') return 'won'
  if (stage === 'Lost') return 'lost'
  return 'open'
}

/** True once a prospect has been approached at all. */
export function hasBeenContacted(stage: Stage): boolean {
  // 'Lost' sits after 'Won' in STAGES, so it clears the bar on rank alone — which
  // is the intent here, unlike in events.ts where it must not read as progress.
  return stageRank(stage) >= CONTACTED_BAR
}

export interface ContactedRow {
  opportunity: Opportunity
  company: Company
  contact: Contact
}

/**
 * One exported record. Flat and self-describing: the consumer is a language
 * model, so a column reads better as `company` than as a joined id.
 *
 * Grouped by what a reader is asking. Identity, then where the deal stands,
 * then the dates, then the derived intervals, then the written record. Column
 * order is the reading order — a model scanning left to right meets the facts
 * before the arithmetic over them.
 */
export interface ExportRow {
  /* — identity — */
  company: string
  domain: string
  industry: string
  location: string
  companySize: string
  employeeCount: string
  /* — where it stands — */
  stage: Stage
  stageIndex: string
  stageStatus: string
  status: string
  priority: string
  dealValueSEK: string
  inPipeline: string
  /* — people — */
  contactName: string
  contactRole: string
  contactEmail: string
  contactPhone: string
  contactLinkedin: string
  followedUpBy: string
  /* — dates, all YYYY-MM-DD — */
  firstContactDate: string
  firstContactSource: string
  meetingBookedDate: string
  meetingBookedSource: string
  meetingBookedStatus: string
  wonDate: string
  lastContacted: string
  followUpDate: string
  lastNoteDate: string
  lastActivityDate: string
  /* — what the history is worth — */
  historyQuality: string
  eventCount: string
  eventDayCount: string
  stagePath: string
  /* — intervals, in days, as of exportedOn — */
  daysSinceContact: string
  daysSinceAnyActivity: string
  daysUntilFollowUp: string
  followUpStatus: string
  daysInPipeline: string
  daysContactedToMeeting: string
  engagementDepth: string
  /* — the written record — */
  nextStep: string
  noteCount: string
  openTaskCount: string
  openTasks: string
  tags: string
  notes: string
  noteHistory: string
  /* — provenance — */
  exportedOn: string
}

/**
 * A single CSV field.
 *
 * Always quoted rather than only when it has to be. Company names and free-text
 * notes carry commas, quotes, newlines and — in Swedish data — semicolons, and a
 * conditional quoter is one unusual name away from a shifted column. Embedded
 * quotes are doubled per RFC 4180.
 */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Collapse whitespace so a multi-line note stays on its own row.
 *
 * Quoting alone keeps embedded newlines legal CSV, but a model reading the file
 * as plain text sees the record break apart. Cheaper to flatten than to rely on
 * every consumer parsing correctly.
 */
function flatten(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/* ———— dates ———— */

/**
 * Local midnight for a `YYYY-MM-DD`, or null if there isn't one.
 *
 * Parsed field-by-field rather than through `new Date(string)`, which reads a
 * bare date as UTC midnight — west of Greenwich that lands on the previous local
 * day and every interval below comes out a day short. Same reasoning, and the
 * same shape, as `dayStart` in lib/db/events.ts.
 */
function parseDay(value: string | undefined): Date | null {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `YYYY-MM-DD` in local terms — matches lib/db/board-metrics.isoDate. */
function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The calendar-day part of an ISO timestamp, in local terms.
 *
 * Notes and tasks store a full `toISOString()`, so slicing the first ten
 * characters would report the UTC day — a note written at 23:30 in Stockholm
 * would export as the following date. Going through Date keeps every date column
 * in the file on the same local calendar as `lastInteraction`.
 */
function isoDayOf(timestamp: string | undefined): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '' : isoDate(date)
}

/** Whole days from `from` to `to`, both already local midnights. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * A number as a string, or '' for "not computable".
 *
 * Empty rather than 0 or -1 when a date is missing: a model reading 0 concludes
 * "contacted today", and reading -1 concludes something worse. An empty cell is
 * the only value that reads as absent.
 */
function num(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * Column order and headings.
 *
 * Headings are machine-friendly rather than prose — `days_since_contact`, not
 * "Days since contact". The file is read by a model that will refer to columns
 * by name in its own reasoning and code, and a bare identifier survives that
 * round trip; a spaced, capitalised label has to be quoted and gets mangled.
 * The companion `docs/export-schema.md` carries the human explanation.
 */
const HEADERS: Array<{ key: keyof ExportRow; label: string }> = [
  { key: 'company', label: 'company' },
  { key: 'domain', label: 'domain' },
  { key: 'industry', label: 'industry' },
  { key: 'location', label: 'location' },
  { key: 'companySize', label: 'company_size' },
  { key: 'employeeCount', label: 'employee_count' },

  { key: 'stage', label: 'stage' },
  { key: 'stageIndex', label: 'stage_index' },
  { key: 'stageStatus', label: 'stage_status' },
  { key: 'status', label: 'status' },
  { key: 'priority', label: 'priority' },
  { key: 'dealValueSEK', label: 'deal_value_sek' },
  { key: 'inPipeline', label: 'in_pipeline' },

  { key: 'contactName', label: 'contact_name' },
  { key: 'contactRole', label: 'contact_role' },
  { key: 'contactEmail', label: 'contact_email' },
  { key: 'contactPhone', label: 'contact_phone' },
  { key: 'contactLinkedin', label: 'contact_linkedin' },
  { key: 'followedUpBy', label: 'followed_up_by' },

  { key: 'firstContactDate', label: 'first_contact_date' },
  { key: 'firstContactSource', label: 'first_contact_source' },
  { key: 'meetingBookedDate', label: 'meeting_booked_date' },
  { key: 'meetingBookedSource', label: 'meeting_booked_source' },
  { key: 'meetingBookedStatus', label: 'meeting_booked_status' },
  { key: 'wonDate', label: 'won_date' },
  { key: 'lastContacted', label: 'last_contacted' },
  { key: 'followUpDate', label: 'follow_up_date' },
  { key: 'lastNoteDate', label: 'last_note_date' },
  { key: 'lastActivityDate', label: 'last_activity_date' },

  { key: 'historyQuality', label: 'history_quality' },
  { key: 'eventCount', label: 'event_count' },
  { key: 'eventDayCount', label: 'event_day_count' },
  { key: 'stagePath', label: 'stage_path' },

  { key: 'daysSinceContact', label: 'days_since_contact' },
  { key: 'daysSinceAnyActivity', label: 'days_since_any_activity' },
  { key: 'daysUntilFollowUp', label: 'days_until_follow_up' },
  { key: 'followUpStatus', label: 'follow_up_status' },
  { key: 'daysInPipeline', label: 'days_in_pipeline' },
  { key: 'daysContactedToMeeting', label: 'days_contacted_to_meeting' },
  { key: 'engagementDepth', label: 'engagement_depth' },

  { key: 'nextStep', label: 'next_step' },
  { key: 'noteCount', label: 'note_count' },
  { key: 'openTaskCount', label: 'open_task_count' },
  { key: 'openTasks', label: 'open_tasks' },
  { key: 'tags', label: 'tags' },
  { key: 'notes', label: 'notes' },
  { key: 'noteHistory', label: 'note_history' },

  { key: 'exportedOn', label: 'exported_on' },
]

/**
 * Everything the export can say about history, beyond the opportunity itself.
 *
 * Optional so the signature stays usable from a caller that has no note or task
 * store to hand — an omitted list costs those columns and nothing else.
 */
export interface ExportContext {
  colleagueName: (id: string | undefined) => string
  notes?: Note[]
  tasks?: Task[]
  /**
   * The activity log, keyed by opportunity id — from app/actions/export.ts.
   *
   * Optional, and its absence is a supported state rather than an error: an
   * export taken while the log read failed still produces every column that
   * needs no history. `historyQuality` reports `none` for those rows, so the
   * degradation is visible in the file rather than looking like prospects that
   * genuinely have no recorded activity.
   */
  events?: Record<string, CrmEventRecord[]>
  /** Overridable so the derived intervals are testable; defaults to now. */
  today?: Date
}

/**
 * The first event of a kind, and how much its date can be trusted.
 *
 * Prefers an `observed` event over a `logged` or `backfilled` one even when the
 * observed date is later. A witnessed transition is a fact about when something
 * happened; a reconstructed date is an inference from where the prospect ended
 * up, and picking the earlier of the two would systematically prefer the guess.
 */
function firstEventOf(
  events: CrmEventRecord[],
  kind: CrmEventKind
): CrmEventRecord | null {
  const matching = events.filter((event) => event.kind === kind)
  if (matching.length === 0) return null
  return (
    matching.find((event) => event.provenance === 'observed') ??
    matching.find((event) => event.provenance === 'logged') ??
    matching[0]
  )
}

/**
 * How much the dated history for one prospect is actually worth.
 *
 *   observed    — at least one witnessed stage transition.
 *   logged      — dates the operator entered by hand, no witnessed transition.
 *   backfilled  — every event reconstructed from the stage the prospect sits in.
 *                 The dates are inferences that all share one day.
 *   none        — no events at all. Real, and distinct from a thin history.
 *
 * Ranked by the best tier present rather than the worst: one witnessed
 * transition among reconstructions still means something genuinely happened on
 * that date, and the per-date `*_source` columns say which dates those are.
 */
function historyQualityOf(events: CrmEventRecord[]): string {
  if (events.length === 0) return 'none'
  if (events.some((event) => event.provenance === 'observed')) return 'observed'
  if (events.some((event) => event.provenance === 'logged')) return 'logged'
  return 'backfilled'
}

/** Notes for one prospect, oldest first — a timeline reads forward. */
function notesFor(notes: Note[], row: ContactedRow): Note[] {
  return notes
    .filter(
      (note) =>
        (note.opportunityId && note.opportunityId === row.opportunity.id) ||
        (note.companyId && note.companyId === row.company.id)
    )
    // Dismissed suggestions are noise the operator explicitly rejected; carrying
    // them would have a model reason from things the team decided against.
    .filter((note) => !note.dismissed)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
}

/** Open, unarchived tasks for one prospect, soonest due first. */
function openTasksFor(tasks: Task[], row: ContactedRow): Task[] {
  return tasks
    .filter(
      (task) =>
        (task.relatedOpportunityId && task.relatedOpportunityId === row.opportunity.id) ||
        (task.relatedCompanyId && task.relatedCompanyId === row.company.id)
    )
    .filter((task) => !task.completed && !task.archivedAt)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
}

/**
 * Every contacted prospect, newest contact first.
 *
 * Sorted by recency rather than alphabetically because a truncated list should
 * lose the oldest touches, not the end of the alphabet.
 */
export function buildExportRows(
  rows: ContactedRow[],
  context: ExportContext
): ExportRow[] {
  const { colleagueName, notes = [], tasks = [], events = {}, today = new Date() } = context

  // One local midnight for the whole file, so every interval is measured from
  // the same instant. Recomputing per row would let a long export straddle
  // midnight and report two different "today"s.
  const asOf = new Date(today)
  asOf.setHours(0, 0, 0, 0)
  const exportedOn = isoDate(asOf)

  return rows
    .filter((row) => hasBeenContacted(row.opportunity.stage))
    .slice()
    .sort((a, b) => (b.opportunity.lastInteraction ?? '').localeCompare(a.opportunity.lastInteraction ?? ''))
    .map((row) => {
      const opp = row.opportunity
      const rowNotes = notesFor(notes, row)
      const rowTasks = openTasksFor(tasks, row)
      const rowEvents = events[opp.id] ?? []

      const lastContacted = flatten(opp.lastInteraction).slice(0, 10)
      const followUpDate = flatten(opp.followUpDate).slice(0, 10)
      const firstNoteDay = isoDayOf(rowNotes[0]?.createdAt)
      const lastNoteDay = isoDayOf(rowNotes[rowNotes.length - 1]?.createdAt)

      const followUpAt = parseDay(followUpDate)
      const firstNoteAt = parseDay(firstNoteDay)
      const lastNoteAt = parseDay(lastNoteDay)

      /* — dates from the log, each with the tier it came from — */

      const contactEvent = firstEventOf(rowEvents, 'prospect_contacted')
      const meetingEvent = firstEventOf(rowEvents, 'meeting_booked')
      const wonEvent = firstEventOf(rowEvents, 'deal_won')

      // The log is the better answer for "when was this first contacted" — it
      // records the first touch, while `lastInteraction` is overwritten by every
      // subsequent one. Falling back to the opportunity field keeps the column
      // populated for the prospects that predate the log entirely.
      const firstContactDate = contactEvent?.occurredOn ?? lastContacted
      const firstContactSource = contactEvent
        ? contactEvent.provenance
        : lastContacted
          ? 'last_contacted_field'
          : ''

      const meetingBookedDate = meetingEvent?.occurredOn ?? ''
      const meetingBookedSource = meetingEvent?.provenance ?? ''

      /**
       * Whether a booked meeting is still true, read from where the deal is now.
       *
       * Not from the log: meeting_booked's weekly card was changed to read
       * current stage rather than an event tally (see loadMeetingsBookedNow in
       * lib/db/board-metrics.ts), and this column answers the same underlying
       * question — is the booking still standing — the same way, so the two
       * cannot disagree. 'Won' and 'Lost' both count as 'standing': a meeting
       * that led to a close, either way, is not one that got un-booked: it ran
       * its course. Anywhere else the deal has moved is a genuine reversal.
       */
      const meetingBookedStatus = !meetingEvent
        ? ''
        : opp.stage === 'Meeting Booked' || opp.stage === 'Won' || opp.stage === 'Lost'
          ? 'standing'
          : 'reversed'

      // Only from the log. There is no `wonDate` on an opportunity, so unlike
      // first contact there is nothing to fall back to — an empty cell here
      // means the transition was never recorded, not that it never happened.
      const wonDate = wonEvent?.occurredOn ?? ''

      const firstContactAt = parseDay(firstContactDate)
      const meetingAt = parseDay(meetingBookedDate)
      const contactedAt = parseDay(lastContacted)

      /* — how far back the record goes — */

      const eventDays = new Set(rowEvents.map((event) => event.occurredOn))
      const historyQuality = historyQualityOf(rowEvents)

      // Where the deal has actually been, oldest first, from witnessed
      // transitions only. Reconstructed events carry no from/to, so a
      // backfilled prospect gets an empty path rather than an invented one.
      const stagePath = rowEvents
        .filter((event) => event.provenance === 'observed' && event.toStage)
        .map((event) => `${event.occurredOn}:${event.fromStage}>${event.toStage}`)
        .join(' | ')

      // The most recent evidence of anything at all, across every source. This
      // is the honest "has this gone quiet" input — a prospect with no contact
      // date but a note from last week has not gone quiet.
      const lastEventAt = parseDay(
        rowEvents.length > 0 ? rowEvents[rowEvents.length - 1].occurredOn : undefined
      )
      const lastActivityAt = [contactedAt, lastNoteAt, lastEventAt]
        .filter((date): date is Date => date !== null)
        .reduce<Date | null>((latest, date) => (!latest || date > latest ? date : latest), null)

      /* — intervals — */

      const daysSinceContact = contactedAt ? daysBetween(contactedAt, asOf) : null
      const daysSinceAnyActivity = lastActivityAt ? daysBetween(lastActivityAt, asOf) : null
      const daysUntilFollowUp = followUpAt ? daysBetween(asOf, followUpAt) : null

      // Matches the "Behöver uppföljning" chip on /prospects: due today or
      // earlier is overdue, and no date is unscheduled rather than overdue.
      const followUpStatus =
        daysUntilFollowUp === null
          ? 'none'
          : daysUntilFollowUp < 0
            ? 'overdue'
            : daysUntilFollowUp === 0
              ? 'due_today'
              : 'scheduled'

      /**
       * Contact → meeting, and only where both dates are genuinely observed.
       *
       * This is the one real velocity measure the log can support, and it is
       * deliberately strict. Backfilled events for a single prospect all share
       * one date, so computing this from them yields 0 for every reconstructed
       * record — a fabricated "we book meetings the same day we call" that a
       * model would happily average into a conclusion. Empty is the honest
       * answer where the dates are not both witnessed.
       */
      const daysContactedToMeeting =
        contactEvent?.provenance === 'observed' &&
        meetingEvent?.provenance === 'observed' &&
        firstContactAt &&
        meetingAt
          ? daysBetween(firstContactAt, meetingAt)
          : null

      /**
       * How much of a relationship there is, as a count of distinct evidence.
       *
       * Not a score with weights — a model can weigh these itself, and an
       * invented 0–100 would imply a precision this data does not have. One
       * point each for: a recorded contact event, a meeting, more than one note,
       * an open task, and a witnessed stage transition.
       */
      const engagementDepth = [
        contactEvent !== null,
        // A meeting that was later walked back still counts here: the meeting
        // was real when it was booked, and this measures how much of a
        // relationship exists, not how well it is currently going.
        // `meetingBookedStatus` is where the reversal shows.
        meetingEvent !== null,
        rowNotes.length > 1,
        rowTasks.length > 0,
        rowEvents.some((event) => event.provenance === 'observed'),
      ].filter(Boolean).length

      return {
        company: flatten(row.company.name),
        domain: flatten(row.company.domain),
        industry: flatten(row.company.industry),
        location: flatten(row.company.location),
        companySize: flatten(row.company.size),
        employeeCount: num(row.company.employeeCount ?? null),

        stage: opp.stage,
        // Position in the canonical nine, so a model can order stages without
        // being told the sequence. 1-based: "3 of 9" reads as a position.
        stageIndex: String(stageRank(opp.stage) + 1),
        stageStatus: stageStatus(opp.stage),
        // Kept alongside stage_status because the two answer different
        // questions: whether the deal is decided, and whether it is still worth
        // approaching. A Lost company is decided but re-approachable.
        status: stageStatus(opp.stage) === 'open' ? 'active' : 'closed',
        priority: opp.priority,
        // Base currency, matching how the value is stored — never the operator's
        // display currency, which varies per browser (see lib/settings.ts).
        dealValueSEK: num(opp.dealValue ?? null),
        inPipeline: opp.inPipeline ? 'yes' : 'no',

        contactName: flatten(row.contact.name),
        contactRole: flatten(row.contact.role),
        contactEmail: flatten(row.contact.email),
        contactPhone: flatten(row.contact.phone),
        contactLinkedin: flatten(row.contact.linkedin),
        followedUpBy: flatten(colleagueName(opp.followedUpBy)),

        firstContactDate,
        firstContactSource,
        meetingBookedDate,
        meetingBookedSource,
        meetingBookedStatus,
        wonDate,
        // Raw YYYY-MM-DD, not the user's display format: the file is machine
        // input, and an ISO date is the one form that never reads as ambiguous.
        lastContacted,
        followUpDate,
        lastNoteDate: lastNoteDay,
        lastActivityDate: lastActivityAt ? isoDate(lastActivityAt) : '',

        historyQuality,
        eventCount: String(rowEvents.length),
        // How many *distinct days* the log touches. The load-bearing number for
        // whether any interval derived from this prospect means anything: a 1
        // says every recorded event shares one date, so no duration can be
        // computed from it however many events there are.
        eventDayCount: String(eventDays.size),
        stagePath,

        daysSinceContact: num(daysSinceContact),
        daysSinceAnyActivity: num(daysSinceAnyActivity),
        daysUntilFollowUp: num(daysUntilFollowUp),
        followUpStatus,
        // From first recorded contact, not from an invented creation date.
        daysInPipeline: firstContactAt ? String(daysBetween(firstContactAt, asOf)) : '',
        daysContactedToMeeting: num(daysContactedToMeeting),
        engagementDepth: String(engagementDepth),

        nextStep: flatten(opp.nextStep),
        noteCount: String(rowNotes.length),
        openTaskCount: String(rowTasks.length),
        // Each task dated inline, so the string stays readable as a list without
        // needing a second file to join against.
        openTasks: rowTasks
          .map((task) => `${flatten(task.title)}${task.dueDate ? ` (due ${task.dueDate.slice(0, 10)})` : ''}`)
          .join(' | '),
        tags: opp.tags.join(' | '),
        notes: flatten(opp.notes),
        // The dated timeline, oldest first. `|` rather than a newline: a newline
        // is legal inside a quoted CSV field but breaks the record visually for
        // anything reading the file as plain text, which is the likeliest way a
        // model will meet it.
        noteHistory: rowNotes
          .map((note) => `${isoDayOf(note.createdAt)}: ${flatten(note.raw)}`)
          .join(' | '),

        // Every interval above is relative to this date. Without it the numbers
        // silently rot — a file read a month later would have a model reasoning
        // about "12 days since contact" that is now 42.
        exportedOn,
      }
    })
}

export function toCSV(rows: ExportRow[]): string {
  const lines = [
    HEADERS.map((h) => csvField(h.label)).join(','),
    ...rows.map((row) => HEADERS.map((h) => csvField(String(row[h.key] ?? ''))).join(',')),
  ]
  // CRLF per RFC 4180 — Excel on Windows is the likeliest second consumer.
  return lines.join('\r\n')
}

/** `YYYY-MM-DD` in local time, for the filename. */
function isoToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function exportFilename(): string {
  return `khyte-contacted-prospects-${isoToday()}.csv`
}

/**
 * Hand the CSV to the browser as a download.
 *
 * A BOM is prepended because Excel otherwise reads a UTF-8 CSV as the system
 * codepage and mangles å/ä/ö — which is most of the company names in this data.
 * The object URL is revoked on the next frame; revoking synchronously can cancel
 * the download in some browsers before it starts.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}
