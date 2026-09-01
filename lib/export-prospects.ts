import type { Company, Contact, Opportunity, Stage } from '@/lib/types'
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
 */

/** Stage order, by index in the canonical list — mirrors lib/db/events.ts. */
const stageRank = (stage: Stage): number => STAGES.indexOf(stage)

const CONTACTED_BAR = stageRank('Contacted')

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
 */
export interface ExportRow {
  company: string
  domain: string
  industry: string
  location: string
  stage: Stage
  contactName: string
  contactRole: string
  contactEmail: string
  lastContacted: string
  followedUpBy: string
  notes: string
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

const HEADERS: Array<{ key: keyof ExportRow; label: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'domain', label: 'Domain' },
  { key: 'industry', label: 'Industry' },
  { key: 'location', label: 'Location' },
  { key: 'stage', label: 'Stage' },
  { key: 'contactName', label: 'Contact' },
  { key: 'contactRole', label: 'Role' },
  { key: 'contactEmail', label: 'Email' },
  { key: 'lastContacted', label: 'Last contacted' },
  { key: 'followedUpBy', label: 'Followed up by' },
  { key: 'notes', label: 'Notes' },
]

/**
 * Every contacted prospect, newest contact first.
 *
 * Sorted by recency rather than alphabetically because a truncated list should
 * lose the oldest touches, not the end of the alphabet.
 */
export function buildExportRows(
  rows: ContactedRow[],
  colleagueName: (id: string | undefined) => string
): ExportRow[] {
  return rows
    .filter((row) => hasBeenContacted(row.opportunity.stage))
    .slice()
    .sort((a, b) => (b.opportunity.lastInteraction ?? '').localeCompare(a.opportunity.lastInteraction ?? ''))
    .map((row) => ({
      company: flatten(row.company.name),
      domain: flatten(row.company.domain),
      industry: flatten(row.company.industry),
      location: flatten(row.company.location),
      stage: row.opportunity.stage,
      contactName: flatten(row.contact.name),
      contactRole: flatten(row.contact.role),
      contactEmail: flatten(row.contact.email),
      // Raw YYYY-MM-DD, not the user's display format: the file is machine input,
      // and an ISO date is the one form that never reads as ambiguous.
      lastContacted: flatten(row.opportunity.lastInteraction),
      followedUpBy: flatten(colleagueName(row.opportunity.followedUpBy)),
      notes: flatten(row.opportunity.notes),
    }))
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
