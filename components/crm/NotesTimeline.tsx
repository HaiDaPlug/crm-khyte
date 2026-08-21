import { Note } from '@/lib/types'
import { MessageSquare, Sparkles } from 'lucide-react'
import { useFormat } from '@/lib/hooks/useFormat'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface NotesTimelineProps {
  notes: Note[]
}

export function NotesTimeline({ notes }: NotesTimelineProps) {
  const { t } = useTranslations()
  const fmt = useFormat()
  if (notes.length === 0) {
    return (
      <p className="text-[13px] text-muted text-center py-6">{t.crm.notes.empty}</p>
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
              {fmt.dateTime(note.createdAt)}
            </p>
            <p className="text-[13px] text-foreground leading-relaxed">{note.raw}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
