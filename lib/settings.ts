import type { CurrencyCode, DateFormat, LocaleCode, Settings } from '@/lib/types'

/**
 * Display preferences. These change how existing data is rendered — never what
 * is stored. Amounts are persisted as plain numbers and dates as ISO strings;
 * everything here is a read-time formatting decision, so switching currency
 * relabels the same figures rather than converting them.
 */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  language: 'sv',
  currency: 'USD',
  locale: 'sv-SE',
  dateFormat: 'locale',
  compactNumbers: true,
}

export const CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: 'SEK', label: 'Swedish Krona', symbol: 'kr' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
]

export const LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'en-US', label: 'English (United States)' },
  { code: 'en-GB', label: 'English (United Kingdom)' },
  { code: 'de-DE', label: 'Deutsch (Deutschland)' },
  { code: 'fr-FR', label: 'Français (France)' },
  { code: 'es-ES', label: 'Español (España)' },
  { code: 'nl-NL', label: 'Nederlands (Nederland)' },
  { code: 'sv-SE', label: 'Svenska (Sverige)' },
  { code: 'ja-JP', label: '日本語 (日本)' },
]

export const DATE_FORMATS: { value: DateFormat; label: string; hint: string }[] = [
  { value: 'locale', label: 'Match language', hint: 'Follows the selected region' },
  { value: 'iso', label: 'ISO', hint: '2026-04-02' },
  { value: 'us', label: 'US', hint: '04/02/2026' },
  { value: 'eu', label: 'European', hint: '02.04.2026' },
]

/**
 * `Intl` throws on an unsupported currency/locale pair rather than degrading,
 * and a settings page is exactly where an unexpected combination arrives. Any
 * failure falls back to the raw number so a bad preference can never blank out
 * a deal value.
 */
function safeFormat(run: () => string, fallback: string): string {
  try {
    return run()
  } catch {
    return fallback
  }
}

/**
 * Money, in the user's chosen currency and regional number style.
 *
 * `compact` collapses large sums to 517K rather than 517,000 — used for the
 * dashboard tiles and pipeline totals, where the magnitude matters more than
 * the exact figure. Explicit `compact: false` overrides the preference for
 * places that must always show the full number.
 */
export function formatCurrency(
  value: number,
  settings: Settings,
  options?: { compact?: boolean }
): string {
  const compact = options?.compact ?? settings.compactNumbers
  return safeFormat(
    () =>
      new Intl.NumberFormat(settings.locale, {
        style: 'currency',
        currency: settings.currency,
        notation: compact && Math.abs(value) >= 1000 ? 'compact' : 'standard',
        maximumFractionDigits: compact && Math.abs(value) >= 1000 ? 1 : 0,
      }).format(value),
    `${value}`
  )
}

/**
 * The currency symbol as the chosen locale writes it — "kr" for SEK under
 * sv-SE, but "SEK" under en-US. Read out of Intl rather than a hardcoded table
 * so an input prefix can never disagree with what formatCurrency renders.
 */
export function currencySymbol(settings: Settings): string {
  return safeFormat(() => {
    const parts = new Intl.NumberFormat(settings.locale, {
      style: 'currency',
      currency: settings.currency,
    }).formatToParts(0)
    return parts.find((part) => part.type === 'currency')?.value ?? settings.currency
  }, settings.currency)
}

/** A plain count, in the user's regional number style. */
export function formatNumber(value: number, settings: Settings): string {
  return safeFormat(() => new Intl.NumberFormat(settings.locale).format(value), `${value}`)
}

/**
 * An ISO date string (`YYYY-MM-DD`) rendered in the chosen format. Unparseable
 * input is passed straight through — the stored value is more useful on screen
 * than "Invalid Date".
 */
export function formatDate(dateStr: string, settings: Settings): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr

  const pad = (n: number) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())

  switch (settings.dateFormat) {
    case 'iso':
      return `${y}-${m}-${d}`
    case 'us':
      return `${m}/${d}/${y}`
    case 'eu':
      return `${d}.${m}.${y}`
    case 'locale':
    default:
      return safeFormat(
        () =>
          new Intl.DateTimeFormat(settings.locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }).format(date),
        dateStr
      )
  }
}

/** A timestamp with the time of day, for the notes timeline. */
export function formatDateTime(dateStr: string, settings: Settings): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr

  const time = safeFormat(
    () =>
      new Intl.DateTimeFormat(settings.locale, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date),
    ''
  )
  const day = formatDate(dateStr, settings)
  return time ? `${day}, ${time}` : day
}
