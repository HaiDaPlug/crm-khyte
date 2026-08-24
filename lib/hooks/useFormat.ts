'use client'

import { useMemo } from 'react'
import { useCRMStore } from '@/lib/store'
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
      number: (value: number) => formatNumber(value, settings),
    }),
    [settings]
  )
}
