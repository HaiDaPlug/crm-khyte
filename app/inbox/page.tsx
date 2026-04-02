'use client'

import { Topbar } from '@/components/layout/Topbar'
import { CaptureBox } from '@/components/crm/CaptureBox'
import { SuggestionPreviewCard } from '@/components/crm/SuggestionPreviewCard'
import { Note } from '@/lib/types'
import { useCRMStore } from '@/lib/store'
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMins = Math.floor(diffMs / (1000 * 60))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function NoteItem({ note }: { note: Note }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn(
      'bg-surface border border-border rounded-xl p-4 transition-all duration-200',
      'hover:border-border-accent card-glow',
      note.applied && 'border-success/20 bg-success-muted'
    )}>
      <div className="flex items-start justify-between gap-4">
        <p className={cn(
          'text-[13px] text-foreground leading-relaxed flex-1',
          !expanded && 'line-clamp-3'
        )}>
          {note.raw}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted font-mono">
            {formatRelativeTime(note.createdAt)}
          </span>
          {note.aiExtracted && !note.dismissed && (
            <Sparkles size={12} className={note.applied ? 'text-success' : 'text-accent'} />
          )}
        </div>
      </div>

      {note.aiExtracted && !note.dismissed && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2.5 flex items-center gap-1 text-[11px] text-muted hover:text-accent transition-colors"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? 'Hide' : 'Show'} AI extraction
        </button>
      )}

      <div className={cn(
        'overflow-hidden transition-all duration-250 ease-out',
        expanded ? 'max-h-[500px] opacity-100 mt-3' : 'max-h-0 opacity-0 mt-0'
      )}>
        <SuggestionPreviewCard note={note} />
      </div>
    </div>
  )
}

export default function InboxPage() {
  const notes = useCRMStore((s) => s.notes)
  const addNote = useCRMStore((s) => s.addNote)
  const [lastCapturedId, setLastCapturedId] = useState<string | null>(null)

  const handleNewNote = (note: Note) => {
    addNote(note)
    setLastCapturedId(note.id)
  }

  const lastCaptured = lastCapturedId ? notes.find(n => n.id === lastCapturedId) : null

  return (
    <>
      <Topbar title="Inbox" />
      <main className="px-8 py-8 max-w-3xl animate-fade-in-up">
        <div className="mb-2">
          <h2 className="text-[22px] font-display text-foreground tracking-tight">Capture</h2>
          <p className="text-[13px] text-muted mt-1">
            Drop raw thoughts, call notes, or intel. AI extracts structure automatically.
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <CaptureBox onSubmit={handleNewNote} />

          {lastCaptured?.aiExtracted && !lastCaptured.dismissed && (
            <SuggestionPreviewCard note={lastCaptured} />
          )}
        </div>

        {/* Notes feed */}
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="line-accent w-8" />
            <h3 className="label-mono">
              Recent Notes
            </h3>
            <span className="text-[10px] text-muted font-mono bg-surface-raised px-1.5 py-0.5 rounded-md border border-border-subtle">
              {notes.length}
            </span>
          </div>

          <div className="space-y-2.5 stagger-children">
            {notes.map(note => (
              <NoteItem key={note.id} note={note} />
            ))}
          </div>
        </div>
      </main>
    </>
  )
}
