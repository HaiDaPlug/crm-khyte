import type { CurrencyCode, DateFormat, LocaleCode, Settings } from '@/lib/types'

/**
 * Display preferences. These change how existing data is rendered — never what
 * is stored. Amounts are persisted as plain numbers in `BASE_CURRENCY` and
 * dates as ISO strings; everything here is a read-time decision, so switching
 * currency converts the stored figure for display and leaves the stored value
 * untouched.
 */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  language: 'sv',
  currency: 'USD',
  locale: 'sv-SE',
  dateFormat: 'locale',
  compactNumbers: true,
  sounds: true,
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
 * Every `dealValue` in the database is stored in this currency. Nothing reads
 * a per-row currency, so the base has to be a constant — the seed data, the
 * pipeline totals and the deal-value input all speak SEK.
 */
export const BASE_CURRENCY: CurrencyCode = 'SEK'

/**
 * Units of each currency per 1 SEK. Static, hand-maintained figures rounded to
 * the nearest sensible published rate — deal values are estimates to begin
 * with, so a display figure that is right to within a percent or two is worth
 * far more than a live FX dependency on every render.
 *
 * Last reviewed 2026-08-24. Implied crosses: 1 USD ≈ 9.52 SEK,
 * 1 EUR ≈ 11.24 SEK, 1 GBP ≈ 12.82 SEK.
 */
export const FX_RATES: Record<CurrencyCode, number> = {
  SEK: 1,
  USD: 0.105,
  EUR: 0.089,
  GBP: 0.078,
}

/**
 * A stored (base-currency) amount as it reads in the chosen currency.
 * An unknown code passes the figure through rather than zeroing it.
 */
export function convertFromBase(value: number, currency: CurrencyCode): number {
  return value * (FX_RATES[currency] ?? 1)
}

/**
 * The inverse, for the deal-value input — what the user types is denominated
 * in whatever currency the field's prefix shows, and the store only ever holds
 * base. Rounded to a whole unit: deal values are round numbers, and letting
 * 21000 USD land as 199999.99999 SEK would be a worse lie than the FX rate.
 */
export function convertToBase(value: number, currency: CurrencyCode): number {
  return Math.round(value / (FX_RATES[currency] ?? 1))
}

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
 * `value` arrives in `BASE_CURRENCY` and is converted here, so callers can pass
 * a stored figure — or a sum of them — straight through without knowing the
 * display currency.
 *
 * `compact` collapses large sums to 517K rather than 517,000 — used for the
 * dashboard tiles and pipeline totals, where the magnitude matters more than
 * the exact figure. Explicit `compact: false` overrides the preference for
 * places that must always show the full number. Note the threshold and the
 * rounding both apply to the converted amount: 48 000 SEK is compacted, the
 * 5 040 USD it converts to is not.
 */
export function formatCurrency(
  value: number,
  settings: Settings,
  options?: { compact?: boolean }
): string {
  const compact = options?.compact ?? settings.compactNumbers
  const amount = convertFromBase(value, settings.currency)
  return safeFormat(
    () =>
      new Intl.NumberFormat(settings.locale, {
        style: 'currency',
        currency: settings.currency,
        notation: compact && Math.abs(amount) >= 1000 ? 'compact' : 'standard',
        maximumFractionDigits: compact && Math.abs(amount) >= 1000 ? 1 : 0,
      }).format(amount),
    `${Math.round(amount)}`
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
