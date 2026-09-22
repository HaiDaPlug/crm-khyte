'use server'

import { randomUUID } from 'node:crypto'

import { requireAuth, type AuthContext } from '@/lib/auth/guard'
import { scopeMismatch } from '@/lib/actions/scope'
import { crmDatabase } from '@/lib/crm/database'
import { isDirectDbConfigured } from '@/lib/db/pg'
import { isSupabaseConfigured } from '@/lib/supabase/server'
import { unavailablePage, type ExportJournalEntry, type JournalEntryDetail, type JournalEntryView, type JournalPage } from '@/lib/journal/contracts'
import {
  addLink,
  createEntry,
  deleteEntry,
  editEntry,
  getEntry,
  listEntries,
  listExportEntries,
  removeLink,
  type JournalActor,
} from '@/lib/journal/service'
import type { ActionScope } from '@/lib/types'

/**
 * The Journal's write and read path for the browser.
 *
 * Every export here is a POST endpoint in its own right, reachable without the
 * UI, so each one runs the same four checks in the same order before it
 * touches anything:
 *
 *   1. requireAuth()   — the session, thrown on rather than redirected, the
 *                        way every Server Action in this app resolves it.
 *   2. scopeMismatch() — what the tab believed it was, against what arrived
 *                        (lib/actions/scope.ts). Refused before any read.
 *   3. configured()    — without a database there is nowhere for an entry to
 *                        go, and saying "saved" would be a lie that costs the
 *                        writer their text. Writes refuse with `unavailable`;
 *                        reads answer with an empty page whose coverage says
 *                        `unavailable` rather than pretending the Journal is
 *                        empty (decision 12).
 *   4. the service     — lib/journal/service.ts, with the organization and the
 *                        user taken from the session and from nowhere else.
 *
 * The order matters at every step. An unconfigured deployment must not become
 * the one path on which an unauthenticated POST, or a tab acting as somebody
 * else, gets a quiet `{ ok: true }` back — which is the same reasoning as
 * `guardedOk` in ./crm.
 *
 * `origin` IS NEVER TAKEN FROM THE BROWSER. Everything submitted here is
 * `origin: 'person'`. The one action that writes a system line —
 * `logNextStepEntry` — sets it server-side, in this file, where a caller
 * cannot reach it.
 *
 * NO withRetry. These go through the direct Postgres pool, which mints no JWT
 * and therefore cannot hit the clock-skew fault the PostgREST writes in ./crm
 * retry for (lib/db/retry.ts). Errors are reported, never thrown: a thrown
 * Server Action reaches the browser as an opaque digest, and the composer has
 * to be able to tell "already saved" from "the save failed" to know whether it
 * may clear the draft.
 */

/* ———— results ———— */

/** A write. `existing` accompanies `request_key_conflict` so the composer can
 *  link to the entry the key did produce. */
export type JournalActionResult =
  | { ok: true; entry: JournalEntryView; replayed?: boolean }
  | { ok: false; error: string; existing?: JournalEntryView }

/** A page of the feed. */
export type JournalPageActionResult = { ok: true; page: JournalPage } | { ok: false; error: string }

/** One entry with its original text and its history. */
export type JournalEntryActionResult = { ok: true; entry: JournalEntryDetail } | { ok: false; error: string }

/** The entries the CSV export counts, grouped by opportunity id. */
export type ExportJournalResult =
  | { ok: true; journal: Record<string, ExportJournalEntry[]>; unavailable?: boolean }
  | { ok: false; error: string }

/* ———— the gate ———— */

/** Both halves of the database. The Journal reads and writes over the direct
 *  pool, and `isSupabaseConfigured` is what the rest of the app calls demo
 *  mode; neither alone is the whole answer. */
function configured(): boolean {
  return isSupabaseConfigured && isDirectDbConfigured
}

/** Who the write is attributed to. Taken from the session; the scope the
 *  browser sent is compared, never read. */
function actorFor(context: AuthContext): JournalActor {
  return { organizationId: context.organizationId, userId: context.userId, source: 'typed' }
}

/** Reported rather than thrown — see the note above on why. */
function failed(what: string, cause: unknown): { ok: false; error: string } {
  const message = cause instanceof Error ? cause.message : String(cause)
  console.error(`[khyte] journal ${what} failed:`, message)
  return { ok: false, error: message }
}

/* ———— writes ———— */

export async function createJournalEntry(input: unknown, scope: ActionScope): Promise<JournalActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  if (!configured()) return { ok: false, error: 'unavailable' }
  try {
    return await createEntry(crmDatabase(), actorFor(context), input)
  } catch (cause) {
    return failed('create', cause)
  }
}

export async function editJournalEntry(id: string, patch: unknown, scope: ActionScope): Promise<JournalActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  if (!configured()) return { ok: false, error: 'unavailable' }
  try {
    return await editEntry(crmDatabase(), actorFor(context), id, patch)
  } catch (cause) {
    return failed('edit', cause)
  }
}

export async function deleteJournalEntry(id: string, scope: ActionScope): Promise<JournalActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  if (!configured()) return { ok: false, error: 'unavailable' }
  try {
    return await deleteEntry(crmDatabase(), actorFor(context), id)
  } catch (cause) {
    return failed('delete', cause)
  }
}

export async function linkJournalEntry(id: string, target: unknown, scope: ActionScope): Promise<JournalActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  if (!configured()) return { ok: false, error: 'unavailable' }
  try {
    return await addLink(crmDatabase(), actorFor(context), id, target)
  } catch (cause) {
    return failed('link', cause)
  }
}

export async function unlinkJournalEntry(id: string, linkId: string, scope: ActionScope): Promise<JournalActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  if (!configured()) return { ok: false, error: 'unavailable' }
  try {
    return await removeLink(crmDatabase(), actorFor(context), id, linkId)
  } catch (cause) {
    return failed('unlink', cause)
  }
}

/**
 * The line the prospect drawer used to write into `notes` when a next step
 * changed.
 *
 * `origin: 'system'` and `kind: 'update'` are set here, server-side: this is
 * Donna recording a change somebody made, not a person writing something down,
 * and the feed renders the two differently. The browser cannot ask for either.
 *
 * `body` IS THE DRAWER'S OWN COPY, ALREADY LOCALISED. The dictionary lives on
 * the client (lib/i18n), so the alternative would be a second copy of "Next
 * step" in a Server Action that has no idea which language the drawer is in.
 * It is treated as text and nothing more — it is validated by the same schema
 * as anything a person types, and it decides nothing.
 *
 * A FRESH KEY EVERY CALL. A typed capture reuses its request key until the
 * save succeeds, because the person's draft survives a failure and must not
 * become two entries. This has no draft: each submitted change is its own
 * line, and the drawer already refuses a repeat submit, so a new uuid per call
 * is what keeps two genuinely different changes from colliding on one key.
 */
export async function logNextStepEntry(
  opportunityId: string,
  body: string,
  scope: ActionScope
): Promise<JournalActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  if (!configured()) return { ok: false, error: 'unavailable' }
  try {
    return await createEntry(
      crmDatabase(),
      actorFor(context),
      {
        requestKey: randomUUID(),
        text: body,
        kind: 'update',
        // The company's name becomes the label, resolved by the service from
        // the opportunity — the prospect is called by its company everywhere
        // in this CRM, and that name is what survives if it is ever deleted.
        links: [{ type: 'opportunity', id: opportunityId }],
      },
      { origin: 'system' }
    )
  } catch (cause) {
    return failed('next step', cause)
  }
}

/* ———— reads ———— */

export async function loadJournalPage(input: unknown, scope: ActionScope): Promise<JournalPageActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  // An empty page rather than a refusal, with `coverage.unavailable` set: the
  // feed has to be able to say "there is no database here" in the same words
  // it says "there is nothing here yet", and those are not the same sentence.
  if (!configured()) return { ok: true, page: unavailablePage() }
  try {
    return await listEntries(crmDatabase(), { organizationId: context.organizationId }, input)
  } catch (cause) {
    return failed('page read', cause)
  }
}

export async function loadJournalEntry(id: string, scope: ActionScope): Promise<JournalEntryActionResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  if (!configured()) return { ok: false, error: 'unavailable' }
  try {
    return await getEntry(crmDatabase(), { organizationId: context.organizationId }, id)
  } catch (cause) {
    return failed('entry read', cause)
  }
}

/**
 * The Journal half of the contacted-prospect CSV, read alongside
 * `loadExportEvents` (./export) before `buildExportRows` runs.
 *
 * WHY THE EXPORT READS THIS RATHER THAN THE STORE. The client store holds
 * current state, and the Journal is history: a page that has loaded thirty
 * entries for one prospect cannot answer for every prospect in the file. The
 * same reasoning that kept `crm_events` out of the snapshot keeps the Journal
 * out of it.
 *
 * Person-written entries only, not deleted, not dismissed — decision 13, so
 * `note_count` counts what somebody actually wrote rather than the lines the
 * CRM generated about its own columns.
 */
export async function loadExportJournal(opportunityIds: string[], scope: ActionScope): Promise<ExportJournalResult> {
  const context = await requireAuth()
  const mismatch = scopeMismatch(context, scope)
  if (mismatch) return mismatch
  // Reported honestly rather than as an empty history: a CSV whose Journal
  // columns are blank because there is no database should not read like a
  // pipeline nobody has written a word about.
  if (!configured()) return { ok: true, journal: {}, unavailable: true }
  if (opportunityIds.length === 0) return { ok: true, journal: {} }
  try {
    return { ok: true, journal: await listExportEntries(crmDatabase(), { organizationId: context.organizationId }, opportunityIds) }
  } catch (cause) {
    return failed('export read', cause)
  }
}
