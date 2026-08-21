'use client'

import { useMemo } from 'react'
import { useCRMStore } from '@/lib/store'
import {
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
      /** Money in the chosen currency. Pass `{ compact: false }` to force the full figure. */
      currency: (value: number, options?: { compact?: boolean }) =>
        formatCurrency(value, settings, options),
      date: (value: string) => formatDate(value, settings),
      /** Bare symbol for input prefixes and adornments. */
      symbol: currencySymbol(settings),
      dateTime: (value: string) => formatDateTime(value, settings),
      number: (value: number) => formatNumber(value, settings),
    }),
    [settings]
  )
}
