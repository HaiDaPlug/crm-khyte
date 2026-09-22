'use client'

import { useMemo } from 'react'
import { useCRMStore } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { formatJournalDate, formatJournalDateTime, type JournalDateParts } from '@/lib/journal/format'
import {
  convertFromBase,
  convertToBase,
  currencySymbol,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
} from '@/lib/settings'

/**
 * Formatters bound to the user's current display settings.
 *
 * Every amount and date on screen should go through this rather than
 * `toLocaleString()` or a bare `$`, so a settings change reaches the whole app
 * at once. Re-memoised only when the settings object itself changes.
 */
export function useFormat() {
  const settings = useCRMStore((s) => s.settings)
  // The Journal dates in the ORGANIZATION's timezone, not the browser's
  // (decision 7): three colleagues reading one entry must read the same day
  // off it. Everything else here stays on the viewer's own clock.
  const timezone = useCRMStore((s) => s.workspace.organization.timezone)
  const { t } = useTranslations()
  const unknownLabel = t.crm.journal.unknownDate

  return useMemo(
    () => ({
      /**
       * Money in the chosen currency, converted from the stored base figure.
       * Pass `{ compact: false }` to force the full figure.
       */
      currency: (value: number, options?: { compact?: boolean }) =>
        formatCurrency(value, settings, options),
      /**
       * An amount the user typed — denominated in the currency `symbol` shows —
       * back into the base currency the store holds. Every write of a money
       * field goes through this, or the figure lands off by the FX rate.
       */
      toBase: (value: number) => convertToBase(value, settings.currency),
      /** A stored base-currency figure, converted for an editable input — the
       * inverse of `toBase`, before any locale formatting is applied. */
      fromBase: (value: number) => convertFromBase(value, settings.currency),
      date: (value: string) => formatDate(value, settings),
      /** Bare symbol for input prefixes and adornments. */
      symbol: currencySymbol(settings),
      dateTime: (value: string) => formatDateTime(value, settings),
      /**
       * A Journal entry's event time, honouring its precision — a day stays a
       * day rather than being turned into midnight somewhere. See
       * lib/journal/format.ts.
       */
      journalDate: (entry: JournalDateParts) =>
        formatJournalDate(entry, { timezone, locale: settings.locale, unknownLabel }),
      /**
       * A moment the Journal recorded about itself — a revision's timestamp.
       * The organization's zone, so a card does not carry two clocks. Use
       * `dateTime` above for the CRM's own columns, which stay on the
       * viewer's.
       */
      journalDateTime: (value: string) =>
        formatJournalDateTime(value, { timezone, locale: settings.locale }),
      number: (value: number) => formatNumber(value, settings),
    }),
    [settings, timezone, unknownLabel]
  )
}
