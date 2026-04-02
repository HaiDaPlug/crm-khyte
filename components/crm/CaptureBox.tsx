'use client'

import { useState, useRef } from 'react'
import { Send, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Note } from '@/lib/types'

const mockExtractions = [
  {
    company: 'Meridian Labs',
    contact: 'Elena Hartmann',
    suggestedStage: 'Warm' as const,
    painPoints: ['Budget deadline pressure', 'Manual processes'],
    nextStep: 'Schedule follow-up demo',
    followUpDate: '2026-04-01',
  },
  {
    company: 'Nordvik Capital',
    contact: 'Marcus Lindqvist',
    suggestedStage: 'Meeting Booked' as const,
    painPoints: ['Evaluating multiple vendors'],
    nextStep: 'Send comparison deck',
    followUpDate: '2026-04-03',
  },
  {
    company: 'Sable Analytics',
    contact: 'Priya Nair',
    suggestedStage: 'Proposal Sent' as const,
    painPoints: ['Contract terms complexity'],
    nextStep: 'Follow up on proposal review',
    followUpDate: '2026-04-02',
  },
]

interface CaptureBoxProps {
  onSubmit: (note: Note) => void
}

export function CaptureBox({ onSubmit }: CaptureBoxProps) {
  const [value, setValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed) return

    setIsSubmitting(true)

    setTimeout(() => {
      const shouldExtract = trimmed.length > 30
      const extraction = shouldExtract
        ? mockExtractions[Math.floor(Math.random() * mockExtractions.length)]
        : undefined

      const newNote: Note = {
        id: `n-${Date.now()}`,
        raw: trimmed,
        createdAt: new Date().toISOString(),
        aiExtracted: extraction,
      }
      onSubmit(newNote)
      setValue('')
      setIsSubmitting(false)
      textareaRef.current?.focus()
    }, 800)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className={cn(
      'bg-surface border border-border rounded-xl overflow-hidden transition-all duration-200',
      'focus-within:border-accent/30 focus-within:shadow-[0_0_24px_-4px_rgba(212,148,60,0.08)]',
    )}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write anything — thoughts, call notes, follow-ups, pain points..."
        className={cn(
          'w-full resize-none px-5 pt-5 pb-2 text-[14px] text-foreground bg-transparent',
          'placeholder:text-muted outline-none leading-relaxed',
          'min-h-[120px]'
        )}
        rows={4}
        autoFocus
      />
      <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle bg-surface-raised/50">
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <Sparkles size={11} className="text-accent" />
          <span>AI extracts structure on save</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted hidden sm:block font-mono opacity-50">⌘↵</span>
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || isSubmitting}
            className={cn(
              'flex items-center gap-1.5 h-8 px-4 rounded-lg text-[12px] font-medium transition-all duration-150',
              value.trim() && !isSubmitting
                ? 'bg-accent text-background hover:bg-accent-hover'
                : 'bg-border text-muted cursor-not-allowed'
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Send size={11} />
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
