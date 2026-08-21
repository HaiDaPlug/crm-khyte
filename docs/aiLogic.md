# AI Logic — Khyte CRM

## North Star

Turn messy human input — a voice note, a rough transcript, a brain-dump — into structured CRM data with minimal friction. The human stays in control; the AI does the extraction and routing.

---

## Input Sources

The AI accepts unstructured text from any of these origins:

- **Voice notes** transcribed by a tool like WhisperFlow or similar
- **Meeting transcripts** copied in raw (not from a structured meetings tool — just the messy output)
- **Manual brain-dumps** typed directly into the dashboard chat

The input does not need to be clean. WhisperFlow output, for example, will have filler words, broken sentences, and unclear references. That is expected and handled downstream.

---

## Extraction Pipeline

### Step 1 — Raw Input
User pastes or types unstructured content into the chat input on the dashboard. No formatting required.

### Step 2 — AI Cleaning Pass
A first AI pass cleans and normalises the text:
- Removes filler words, false starts, and transcription artifacts
- Reconstructs broken sentences where intent is clear
- Does not interpret yet — only cleans

### Step 3 — Intent Extraction
A second AI pass reads the cleaned text and extracts structured intent. It looks for signals that map to one or more of the CRM buckets below.

### Step 4 — Bucket Routing
Extracted intent is routed to one or more buckets:

| Bucket | Triggered by |
|--------|-------------|
| **Task** | Action items, follow-ups, deadlines, things to do |
| **Lead / Opportunity** | Deal signals, deal stage changes, next steps on a company |
| **Company** | New company mentioned, context about an org |
| **Contact** | Person mentioned with role, email, or relationship context |

A single input can produce entries across multiple buckets. Example: a transcript about a call with Marcus at Nordvik could create a contact update, a deal stage change, and two tasks.

### Step 5 — Confidence Check
The AI scores its own confidence on each extracted item:

- **High confidence** → auto-staged for quick approval (one tap)
- **Low confidence** → flagged for manual review before anything is written to the CRM

---

## Human in the Loop

If the AI cannot confidently resolve an extraction — ambiguous company name, unclear action owner, missing context — the item is not silently discarded or guessed. It surfaces in a **review queue** where the user can:

- Confirm and accept the suggestion
- Edit the extracted fields
- Reject and discard

This is the core safety valve. The AI should never write noisy or wrong data into the CRM without human sign-off. Speed matters, but dirty data compounds.

---

## What the AI Does Not Do (yet)

- Does not pull from external meeting tools (Notion, Fireflies, etc.) — input is manual for now
- Does not auto-create records without human review on low-confidence extractions
- Does not send emails or take actions outside the CRM

---

## Open Questions

- What are the exact bucket fields for each category? (e.g. does a Lead need a deal value extracted, or just a company name + next step?)
- Confidence threshold — what score separates auto-stage from manual review?
- Where does the review queue live in the UI? (Dashboard panel, separate page, inline in chat?)
