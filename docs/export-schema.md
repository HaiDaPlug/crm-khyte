# Contacted-prospect export — column contract

Hand this to the model alongside `khyte-contacted-prospects-YYYY-MM-DD.csv`.
It exists so the file itself can stay clean CSV, with no comment preamble for a
parser to trip over.

## What the file is

One row per company **the team has already approached**, exported from the Khyte
CRM. "Approached" means the deal's stage is at or past `Contacted` in the
canonical nine-stage order — so `New` and `Ongoing` are the only stages absent.

`Lost` deals **are included**, deliberately. A lost company is emphatically one
already approached, and dropping it is how a dedup list hands back somebody the
team already burned. Use `stage_status` to tell a dead company from a live one.

The export ignores whatever filters or search were on screen when it was taken:
it is always the complete contacted set.

## Reading the dates

Every date column is `YYYY-MM-DD` in the team's local calendar (Europe/
Stockholm). Every interval column is **whole days relative to `exported_on`**,
not to the day you happen to read the file — if `exported_on` is a month old, add
the offset yourself rather than treating `days_since_contact` as current.

An empty interval cell means **not computable** (the underlying date is missing),
never zero. Do not read a blank as "today" or as "none".

## How much each date can be trusted

This file carries real dated history from the CRM's append-only activity log
(`crm_events`), including witnessed stage transitions. **That history is not
uniform, and treating it as uniform is the main way to get this data wrong.**
Every date derived from the log ships beside a `*_source` column naming one of
three tiers:

| Tier | What it means | Trust |
| --- | --- | --- |
| `observed` | A stage transition the CRM watched happen, dated when it happened. | High — this is a fact about timing. |
| `logged` | The operator typed a contact date into the record afterwards. | Good for *what* happened, decent for *when*. |
| `backfilled` | Reconstructed from the stage a prospect was already sitting in, dated by `last_contacted`. | The date is an **inference**, not an observation. |

The `backfilled` tier has a specific trap. Every event reconstructed for one
prospect shares a single date, so a backfilled `first_contact_date` and
`meeting_booked_date` landing on the same day is an artifact of the
reconstruction — **not** evidence that the team books meetings on first contact.
This is why `days_contacted_to_meeting` is populated only when *both* dates are
`observed`, and left empty otherwise. Do not fill that gap by subtracting the
dates yourself.

`history_quality` gives the best tier available per row, and `event_day_count`
is the number of distinct days the log touches for that prospect. **An
`event_day_count` of 1 means no duration can be computed from that row at all,**
however many events it has.

## What this file still cannot tell you

- **No per-stage dwell time.** In the current data, the overwhelming majority of
  prospects have events on exactly one day, so "how long does a deal sit in
  Warm" is not answerable. `stage_path` gives the witnessed transitions where
  they exist — use it directly rather than inferring durations across rows.
- **`won_date` is currently empty for every row**, because no deal has reached
  `Won` yet and `deal_won` events only exist from that transition.
- **There is no lost date.** Moving a deal to `Lost` deliberately records no
  event (so it cannot read as pipeline progress), so the stage is the only
  evidence and it carries no date.
- **`days_in_pipeline` starts from first *recorded* contact**, so for a prospect
  whose history predates the log it is a lower bound.
- This team files a prospect straight into `Contacted` after calling it, rather
  than adding it at `New` and moving it later. So a company's presence in this
  file already implies real outreach happened.

## Columns

### Identity
| Column | Meaning |
| --- | --- |
| `company` | Company name. Swedish names, so expect å/ä/ö. |
| `domain` | Website domain. May be empty. |
| `industry` | Free-text sector label. |
| `location` | City or region. |
| `company_size` | Free-text band, e.g. `50-200`. Not a number. |
| `employee_count` | Headcount as an integer, when known. |

### Where the deal stands
| Column | Meaning |
| --- | --- |
| `stage` | One of the nine: `New`, `Ongoing`, `Contacted`, `Warm`, `Meeting Booked`, `Proposal Sent`, `Negotiation`, `Won`, `Lost`. |
| `stage_index` | Position in that sequence, 1–9. Use this to order stages. **Caution:** `Lost` is index 9 for positional reasons and is *not* "further along" than `Won`. |
| `stage_status` | `open` / `won` / `lost`. The reliable way to read outcome — prefer this over `stage_index`. |
| `status` | `active` / `closed`. Whether the deal is decided. A `closed` company can still be worth re-approaching. |
| `priority` | `low` / `medium` / `high` / `critical`, set by the operator. |
| `deal_value_sek` | Deal size in **SEK**, the base currency. Empty when unset. |
| `in_pipeline` | `yes` / `no` — whether it appears on the pipeline board. |

### People
| Column | Meaning |
| --- | --- |
| `contact_name`, `contact_role`, `contact_email`, `contact_phone`, `contact_linkedin` | The primary contact. Any may be empty. |
| `followed_up_by` | Which of the three colleagues (Erik, Abdi, Hai) owns follow-up. Empty means unassigned. |

### Dates
| Column | Meaning |
| --- | --- |
| `first_contact_date` | When this prospect was first contacted, from the log. Better than `last_contacted` for this question, which is overwritten by every later touch. |
| `first_contact_source` | `observed` / `logged` / `backfilled` / `last_contacted_field`. The last means there was no log entry and the opportunity's own field was used. |
| `meeting_booked_date` | When a meeting was **first** booked. Empty means never. |
| `meeting_booked_source` | Same three tiers, for that date. |
| `meeting_booked_status` | `standing` or `reversed`. A meeting booked and later dragged back out is `reversed` — the booking was real on its date, but the deal is not sitting there now. This is why more rows carry a meeting date than currently sit in that stage. |
| `won_date` | When the deal was won. Currently empty for every row — see caveats. |
| `last_contacted` | Most recent recorded interaction, maintained by hand. |
| `follow_up_date` | The scheduled next touch. Empty means unscheduled, **not** overdue. |
| `last_note_date` | Date of the most recent note. |
| `last_activity_date` | Most recent evidence of anything — contact, note, or logged event. |

### What the history is worth
| Column | Meaning |
| --- | --- |
| `history_quality` | `observed` / `logged` / `backfilled` / `none` — the best tier available for this row. `none` means no events at all, which is different from a thin history. |
| `event_count` | How many events are on the log for this prospect. |
| `event_day_count` | How many **distinct days** those events span. A 1 means no duration is computable from this row. |
| `stage_path` | The witnessed transitions, oldest first, as `YYYY-MM-DD:From>To`, separated by ` \| `. Empty where no transition was witnessed — never reconstructed. |

### Intervals — days, relative to `exported_on`
| Column | Meaning |
| --- | --- |
| `days_since_contact` | Days since `last_contacted`. Higher = gone quieter. |
| `days_since_any_activity` | Days since `last_activity_date`. The better "gone quiet" signal — a prospect with an old contact date but a recent note has not gone quiet. |
| `days_until_follow_up` | Days until `follow_up_date`. **Negative means overdue.** |
| `follow_up_status` | `overdue` / `due_today` / `scheduled` / `none`. Precomputed so you needn't infer it. |
| `days_in_pipeline` | First recorded contact → `exported_on`. Lower bound; see caveats. |
| `days_contacted_to_meeting` | Contact → first meeting, **only where both dates are `observed`.** Empty otherwise, on purpose. Do not reconstruct it from the raw dates. |
| `engagement_depth` | 0–5, counting distinct evidence of a relationship: a recorded contact, a meeting, more than one note, an open task, and a witnessed transition. A deliberately coarse count, not a weighted score — the data does not support finer precision. |

### The written record
| Column | Meaning |
| --- | --- |
| `next_step` | The operator's own note on what happens next. |
| `note_count` | Number of notes, excluding ones the operator dismissed. |
| `open_task_count` | Open, unarchived tasks attached to this company. |
| `open_tasks` | Those tasks as `title (due YYYY-MM-DD)`, separated by ` \| `. |
| `tags` | Opportunity tags, separated by ` \| `. |
| `notes` | The opportunity's own free-text note field. Whitespace collapsed to one line. |
| `note_history` | The dated note timeline, **oldest first**, as `YYYY-MM-DD: text`, separated by ` \| `. Dismissed notes are excluded — the team explicitly rejected those, so don't reason from them. |

### Provenance
| Column | Meaning |
| --- | --- |
| `exported_on` | The date the file was generated. Every interval column is measured from here. |

## Format notes

- Every field is quoted unconditionally; embedded quotes are doubled (RFC 4180).
- Whitespace inside a field is collapsed to single spaces, so no record ever
  breaks across lines even when read as plain text.
- Line endings are CRLF; the file carries a UTF-8 BOM so Excel doesn't mangle
  å/ä/ö.
- Rows are sorted by `last_contacted`, newest first — a truncated file loses the
  oldest touches rather than the end of the alphabet.
- Multi-value fields use ` | ` as the separator, never a comma.

## Questions this file answers well

Which contacted companies have gone quiet (`days_since_any_activity`), who is
overdue (`follow_up_status`), how outreach is distributed across the three
colleagues (`followed_up_by`), where value concentrates by stage or industry
(`deal_value_sek` × `stage_status`), which deals have movement versus only a
stage label (`stage_path`, `engagement_depth`), how many bookings held versus
reversed (`meeting_booked_status`), and what was actually said over time
(`note_history`).

## Questions it answers badly

- **Per-stage dwell time and stage-to-stage conversion rates.** Most rows have
  events on a single day; the data is not there.
- **Win rates and sales-cycle length.** No deal has reached `Won`.
- **Anything averaged across mixed provenance.** Before computing a statistic
  over a date column, filter to the rows whose `*_source` is `observed`, and say
  how many rows that left — an average over `backfilled` dates is an average
  over inferences.

## A note on sample size

At time of writing this exports ~145 prospects, of which the great majority sit
at `Contacted` with a single recorded event. Sub-groups get small fast: there
are single-digit counts of meetings booked and no wins at all. Report counts
alongside any rate you compute, and prefer describing what happened to
estimating a trend from it.
