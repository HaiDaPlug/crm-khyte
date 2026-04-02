import { Note } from '@/lib/types'
import { MessageSquare, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NotesTimelineProps {
  notes: Note[]
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function NotesTimeline({ notes }: NotesTimelineProps) {
  if (notes.length === 0) {
    return (
      <p className="text-[13px] text-muted text-center py-6">No notes yet.</p>
    )
  }

  return (
    <div className="space-y-0 stagger-children">
      {notes.map((note, i) => (
        <div key={note.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
              note.aiExtracted ? 'bg-accent-light' : 'bg-surface-raised'
            )}>
              {note.aiExtracted ? (
                <Sparkles size={11} className="text-accent" />
              ) : (
                <MessageSquare size={11} className="text-muted" />
              )}
            </div>
            {i < notes.length - 1 && (
              <div className="w-px flex-1 bg-border-subtle mt-1 min-h-[16px]" />
            )}
          </div>
          <div className="flex-1 pb-5">
            <p className="text-[10px] text-muted font-mono mb-1.5">
              {formatDate(note.createdAt)}
            </p>
            <p className="text-[13px] text-foreground leading-relaxed">{note.raw}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
