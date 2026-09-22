import type { OccurredPrecision } from './contracts'

/**
 * Rendering an entry's event time without inventing precision it does not have.
 *
 * Client-safe (no `server-only`, no React): the cards use it through
 * `useFormat().journalDate`, and tests/store.test.ts calls it directly.
 *
 * THE BUG THIS EXISTS TO AVOID. `new Date('2026-09-22')` is midnight UTC, and
 * formatting that instant in any zone west of Greenwich prints the 21st. The
 * `day` and `month` precisions carry no instant — somebody picked a date, not
 * a moment — so they are formatted from their own `YYYY-MM-DD` parts, pinned
 * to UTC purely so `Intl` has a calendar day to work from, and never converted
 * into anybody's local time. `exact` is the opposite case: it IS an instant,
 * and it is shown in the organization's timezone (decision 7) so that the
 * three people in one workspace read the same day off the same entry.
 *
 * `formatDate`/`formatDateTime` in lib/settings.ts are untouched and still
 * render the CRM's own date columns in the viewer's browser zone. The Journal
 * needs a different answer, not a changed one.
 */

export interface JournalDateParts {
  occurredPrecision: OccurredPrecision
  occurredOn: string | null
  occurredAt: string | null
}

export interface JournalDateOptions {
  /** The organization's timezone — an IANA name, e.g. `Europe/Stockholm`. */
  timezone: string
  locale: string
  /** What `unknown` reads as; the dictionary owns the words, not this module. */
  unknownLabel: string
}

/** `Intl` throws on an unsupported locale or zone rather than degrading. */
function safe(run: () => string, fallback: string): string {
  try {
    return run()
  } catch {
    return fallback
  }
}

/** `YYYY-MM-DD` → the calendar day as a UTC instant, or null if unparseable. */
function calendarDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * One entry's event time, as the card shows it.
 *
 * Falls back to the stored string rather than "Invalid Date" whenever the
 * value cannot be read — the same choice `formatDate` makes, and for the same
 * reason: the raw value is more use on screen than an error.
 */
export function formatJournalDate(entry: JournalDateParts, options: JournalDateOptions): string {
  const { timezone, locale, unknownLabel } = options

  switch (entry.occurredPrecision) {
    case 'exact': {
      if (!entry.occurredAt) return entry.occurredOn ?? unknownLabel
      const instant = new Date(entry.occurredAt)
      if (Number.isNaN(instant.getTime())) return entry.occurredAt
      return safe(
        () =>
          new Intl.DateTimeFormat(locale, {
            timeZone: timezone,
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(instant),
        entry.occurredAt
      )
    }

    case 'day': {
      if (!entry.occurredOn) return unknownLabel
      const day = calendarDay(entry.occurredOn)
      if (!day) return entry.occurredOn
      // `timeZone: 'UTC'` against a UTC-constructed day is what keeps the
      // printed date equal to the stored one in every viewer's zone.
      return safe(
        () => new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' }).format(day),
        entry.occurredOn
      )
    }

    case 'month': {
      if (!entry.occurredOn) return unknownLabel
      const day = calendarDay(entry.occurredOn)
      if (!day) return entry.occurredOn
      return safe(
        () =>
          new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(day),
        entry.occurredOn
      )
    }

    case 'unknown':
    default:
      return unknownLabel
  }
}

/**
 * The time of day a feed was last read, for the "Loaded HH:MM" line.
 *
 * In the organization's timezone, like everything else the Journal dates, so
 * "loaded 14:03" means the same thing to all three colleagues.
 */
export function formatJournalTime(iso: string, options: { timezone: string; locale: string }): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  return safe(
    () =>
      new Intl.DateTimeFormat(options.locale, {
        timeZone: options.timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(instant),
    iso
  )
}

/**
 * A moment the Journal recorded about itself — when a revision was written.
 *
 * Deliberately not `formatDateTime` from lib/settings, which is the CRM's own
 * columns in the viewer's browser zone. A card whose entry is dated in the
 * organization's zone and whose history is stamped in the reader's is a card
 * with two clocks on it, and the one case where that is not merely untidy is
 * the one that matters: an edit made at 00:30 in Stockholm reads as the day
 * before the entry it edited to anybody sitting west of Greenwich.
 *
 * Same instant-or-raw-string contract as everything else here: a value that
 * cannot be read is shown as it was stored, not as "Invalid Date".
 */
export function formatJournalDateTime(iso: string, options: { timezone: string; locale: string }): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  return safe(
    () =>
      new Intl.DateTimeFormat(options.locale, {
        timeZone: options.timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(instant),
    iso
  )
}
