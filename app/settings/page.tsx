'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Button } from '@/components/crm/Button'
import { useCRMStore } from '@/lib/store'
import {
  CURRENCIES,
  DATE_FORMATS,
  DEFAULT_SETTINGS,
  LOCALES,
  formatCurrency,
  formatDate,
} from '@/lib/settings'
import type { Settings } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { dictionaries } from '@/lib/i18n/translations'

/** A sum big enough to show the compact/full difference, and a date whose
 *  day and month can't be confused for one another in the format preview. */
const SAMPLE_VALUE = 517000
const SAMPLE_DATE = '2026-04-02'

/**
 * A themed dropdown.
 *
 * Deliberately not a native <select>: Chrome renders the option popup with OS
 * chrome that ignores the page's dark palette, which left the list white-on-
 * white and unreadable. This follows the popover pattern already used by the
 * Combobox in FormFields.
 */
function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  // Open onto the current choice rather than the top of the list.
  useEffect(() => {
    if (!open) return
    const i = options.findIndex((o) => o.value === value)
    setActiveIndex(i === -1 ? 0 : i)
  }, [open, options, value])

  const commit = (index: number) => {
    onChange(options[index].value)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(activeIndex)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative w-full sm:w-auto">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 px-3 sm:h-9 sm:w-[230px]',
          'bg-background-raised border rounded-lg text-[14.5px] text-foreground',
          'outline-none transition-colors',
          open ? 'border-accent/40' : 'border-border-subtle hover:border-border'
        )}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-foreground/60 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-surface-raised shadow-[0_12px_32px_-8px_rgba(0,0,0,0.75)] animate-popover-in sm:left-auto sm:right-0 sm:w-[230px]">
          <div role="listbox" aria-label={label} className="max-h-[260px] overflow-y-auto py-1">
            {options.map((option, i) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => commit(i)}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[14.5px] transition-colors',
                  i === activeIndex ? 'bg-accent-light text-foreground' : 'text-foreground/80'
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value && <Check size={14} className="text-accent shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 sm:mb-7">
      <h3 className="label-mono mb-3">{title}</h3>
      <div className="bg-surface border border-border rounded-xl divide-y divide-border-subtle overflow-hidden">
        {children}
      </div>
    </section>
  )
}

function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string
  description?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-[15px] font-medium text-foreground">
          {label}
        </label>
        {description && <p className="text-[13.5px] text-foreground/60 mt-1 leading-snug">{description}</p>}
      </div>
      <div className="flex w-full justify-end sm:w-auto sm:shrink-0">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-full rounded-lg border border-border-subtle bg-background-raised p-0.5 sm:w-auto"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-11 flex-1 rounded-md px-2.5 text-[13.5px] font-medium transition-all duration-150 sm:h-8 sm:min-h-0 sm:flex-none sm:px-3.5',
            value === option.value
              ? 'bg-surface-raised text-foreground'
              : 'text-foreground/60 hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-11 w-11 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:h-6"
    >
      <span
        className={cn(
          'absolute inset-x-0 top-2.5 h-6 rounded-full transition-colors duration-200 sm:top-0',
          checked ? 'bg-accent' : 'bg-border-subtle'
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background transition-transform duration-200',
            checked && 'translate-x-5'
          )}
        />
      </span>
    </button>
  )
}

export default function SettingsPage() {
  const { t } = useTranslations()
  const settings = useCRMStore((s) => s.settings)
  const setSetting = useCRMStore((s) => s.setSetting)
  const resetSettings = useCRMStore((s) => s.resetSettings)

  const isDefault = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).every(
    (k) => settings[k] === DEFAULT_SETTINGS[k]
  )

  return (
    <>
      <Topbar />
      <main className="w-full max-w-3xl flex-1 animate-fade-in-up px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-[28px] font-jakarta font-semibold text-foreground tracking-[-0.02em] leading-none sm:text-[30px]">{t.settings.title}</h2>
            <p className="text-[15px] text-foreground/60 mt-1.5 font-mono tabular-nums">
              {t.settings.description}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={resetSettings}
            disabled={isDefault}
            className="h-11 w-full text-foreground/60 hover:text-foreground sm:h-[38px] sm:w-auto"
          >
            <RotateCcw size={15} />
            {t.settings.reset}
          </Button>
        </div>

        <Section title={t.settings.appearance}>
          <Row label={t.settings.theme} description={t.settings.themeDescription}>
            <Segmented
              label={t.settings.theme}
              value={settings.theme}
              onChange={(v) => setSetting('theme', v)}
              options={[
                { value: 'dark', label: t.settings.dark },
                { value: 'light', label: t.settings.light },
              ]}
            />
          </Row>
        </Section>

        <Section title={t.settings.languageAndRegion}>
          <Row
            label={t.settings.interfaceLanguage}
            description={t.settings.interfaceLanguageDescription}
          >
            <Segmented
              label={t.settings.interfaceLanguage}
              value={settings.language}
              onChange={(v) => setSetting('language', v)}
              options={[
                { value: 'sv', label: dictionaries.sv.languageName },
                { value: 'en', label: dictionaries.en.languageName },
              ]}
            />
          </Row>

          <Row
            label={t.settings.regionalFormat}
            description={t.settings.regionalFormatDescription}
          >
            <Select
              label={t.settings.regionalFormat}
              value={settings.locale}
              onChange={(v) => setSetting('locale', v)}
              options={LOCALES.map((l) => ({ value: l.code, label: l.label }))}
            />
          </Row>

          <Row
            label={t.settings.currency}
            description={t.settings.currencyDescription}
          >
            <Select
              label={t.settings.currency}
              value={settings.currency}
              onChange={(v) => setSetting('currency', v)}
              options={CURRENCIES.map((c) => ({
                value: c.code,
                label: `${c.code} · ${t.settings.currencyNames[c.code]}`,
              }))}
            />
          </Row>

          <Row label={t.settings.dateFormat} description={t.settings.dateFormatDescription}>
            <Segmented
              label={t.settings.dateFormat}
              value={settings.dateFormat}
              onChange={(v) => setSetting('dateFormat', v)}
              options={DATE_FORMATS.map((f) => ({
                value: f.value,
                label: t.settings.dateFormats[f.value],
              }))}
            />
          </Row>

          <Row
            label={t.settings.compactNumbers}
            description={t.settings.compactNumbersDescription}
          >
            <Switch
              label={t.settings.compactNumbers}
              checked={settings.compactNumbers}
              onChange={(v) => setSetting('compactNumbers', v)}
            />
          </Row>

          <Row label={t.settings.sounds} description={t.settings.soundsDescription}>
            <Switch
              label={t.settings.sounds}
              checked={settings.sounds}
              onChange={(v) => setSetting('sounds', v)}
            />
          </Row>
        </Section>

        {/* These options are abstract until you see them applied. */}
        <section>
          <h3 className="label-mono mb-3">{t.settings.preview}</h3>
          <div className="rounded-xl border border-border bg-surface p-4 sm:px-5 sm:py-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <p className="label-mono mb-1.5">{t.settings.dealValue}</p>
                <p className="break-words text-[17px] font-semibold text-foreground tabular-nums">
                  {formatCurrency(SAMPLE_VALUE, settings)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="label-mono mb-1.5">{t.settings.fullFigure}</p>
                <p className="break-words text-[17px] font-semibold text-foreground tabular-nums">
                  {formatCurrency(SAMPLE_VALUE, settings, { compact: false })}
                </p>
              </div>
              <div className="min-w-0">
                <p className="label-mono mb-1.5">{t.settings.followUpDate}</p>
                <p className="break-words text-[17px] font-semibold text-foreground tabular-nums">
                  {formatDate(SAMPLE_DATE, settings)}
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
