'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex items-center justify-between gap-2 h-9 w-[230px] px-3',
          'bg-background-raised border rounded-lg text-[13px] text-foreground',
          'outline-none transition-colors',
          open ? 'border-accent/40' : 'border-border-subtle hover:border-border'
        )}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-muted transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 w-[230px] bg-surface-raised border border-border rounded-lg shadow-[0_12px_32px_-8px_rgba(0,0,0,0.75)] overflow-hidden animate-popover-in">
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
                  'w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors',
                  i === activeIndex ? 'bg-accent-light text-foreground' : 'text-muted-foreground'
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
    <section className="mb-6">
      <h3 className="label-mono mb-2.5">{title}</h3>
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
    <div className="flex items-center justify-between gap-6 px-4 py-3.5">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-foreground">
          {label}
        </label>
        {description && <p className="text-[12px] text-muted mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
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
      className="flex bg-background-raised border border-border-subtle rounded-lg p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-8 px-3 rounded-md text-[12.5px] font-medium transition-all duration-150',
            value === option.value
              ? 'bg-surface-raised text-foreground'
              : 'text-muted hover:text-foreground'
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
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        checked ? 'bg-accent' : 'bg-border-subtle'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-background transition-transform duration-200',
          checked && 'translate-x-5'
        )}
      />
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
      <Topbar title={t.settings.title} />
      <main className="px-8 py-8 flex-1 max-w-3xl animate-fade-in-up">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-[22px] font-display text-foreground tracking-tight">{t.settings.title}</h2>
            <p className="text-[13px] text-muted mt-0.5 font-mono">
              {t.settings.description}
            </p>
          </div>
          <button
            type="button"
            onClick={resetSettings}
            disabled={isDefault}
            className={cn(
              'flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-colors',
              isDefault
                ? 'text-muted/50 cursor-not-allowed'
                : 'text-muted hover:text-foreground hover:bg-surface-raised'
            )}
          >
            <RotateCcw size={13} />
            {t.settings.reset}
          </button>
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
        </Section>

        {/* These options are abstract until you see them applied. */}
        <section>
          <h3 className="label-mono mb-2.5">{t.settings.preview}</h3>
          <div className="bg-surface border border-border rounded-xl px-4 py-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="label-mono mb-1.5">{t.settings.dealValue}</p>
                <p className="text-[16px] font-semibold text-foreground tabular-nums">
                  {formatCurrency(SAMPLE_VALUE, settings)}
                </p>
              </div>
              <div>
                <p className="label-mono mb-1.5">{t.settings.fullFigure}</p>
                <p className="text-[16px] font-semibold text-foreground tabular-nums">
                  {formatCurrency(SAMPLE_VALUE, settings, { compact: false })}
                </p>
              </div>
              <div>
                <p className="label-mono mb-1.5">{t.settings.followUpDate}</p>
                <p className="text-[16px] font-semibold text-foreground tabular-nums">
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
