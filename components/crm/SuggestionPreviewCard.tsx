'use client'

import { Sparkles, ArrowRight, Calendar, ChevronRight, Check } from 'lucide-react'
import { Button } from './Button'
import { Note } from '@/lib/types'
import { useCRMStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/lib/hooks/useTranslations'

interface SuggestionPreviewCardProps {
  note: Note
}

export function SuggestionPreviewCard({ note }: SuggestionPreviewCardProps) {
  const { t } = useTranslations()
  const copy = t.crm.suggestion
  const ai = note.aiExtracted
  const applyNote = useCRMStore((s) => s.applyNote)
  const dismissNote = useCRMStore((s) => s.dismissNote)

  if (!ai || note.dismissed) return null

  const isApplied = note.applied

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden transition-all duration-300 animate-fade-in-up',
      isApplied
        ? 'bg-success-muted border-success/20'
        : 'bg-accent-light border-accent/15'
    )}>
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isApplied ? (
              <Check size={12} className="text-success" />
            ) : (
              <Sparkles size={12} className="text-accent" />
            )}
            <span className={cn(
              'text-[10px] font-semibold uppercase tracking-wider font-mono',
              isApplied ? 'text-success' : 'text-accent'
            )}>
              {isApplied ? copy.applied : copy.extraction}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
          {ai.company && (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-muted font-mono uppercase tracking-wider shrink-0">{copy.company}</span>
              <span className="text-foreground font-medium truncate">{ai.company}</span>
            </div>
          )}
          {ai.contact && (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-muted font-mono uppercase tracking-wider shrink-0">{copy.contact}</span>
              <span className="text-foreground font-medium truncate">{ai.contact}</span>
            </div>
          )}
          {ai.suggestedStage && (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] text-muted font-mono uppercase tracking-wider shrink-0">{copy.stage}</span>
              <span className="bg-accent/15 text-accent text-[11px] font-medium px-1.5 py-0.5 rounded-md">
                {t.stages[ai.suggestedStage]}
              </span>
            </div>
          )}
          {ai.followUpDate && (
            <div className="flex items-baseline gap-2">
              <Calendar size={10} className="text-muted shrink-0 mt-0.5" />
              <span className="text-[10px] text-muted font-mono uppercase tracking-wider shrink-0">{copy.followUp}</span>
              <span className="text-foreground font-medium font-mono text-[12px]">{ai.followUpDate}</span>
            </div>
          )}
        </div>

        {ai.painPoints && ai.painPoints.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <p className="text-[10px] text-muted font-mono uppercase tracking-wider mb-1.5">{copy.painPoints}</p>
            <ul className="space-y-1">
              {ai.painPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                  <ChevronRight size={11} className="mt-0.5 text-accent/60 shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ai.nextStep && (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <div className="flex items-start gap-2">
              <ArrowRight size={12} className="mt-0.5 text-accent shrink-0" />
              <div>
                <span className="text-[10px] text-muted font-mono uppercase tracking-wider block mb-0.5">
                  {copy.suggestedNextStep}
                </span>
                <span className="text-[13px] text-foreground">{ai.nextStep}</span>
              </div>
            </div>
          </div>
        )}

        {!isApplied && (
          <div className="mt-3.5 flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 px-3 text-[11px] gap-0"
              onClick={() => applyNote(note.id)}
            >
              {copy.apply}
            </Button>
            <button
              onClick={() => dismissNote(note.id)}
              className="h-7 px-3 rounded-lg text-[11px] font-medium text-muted hover:text-foreground transition-colors"
            >
              {t.common.dismiss}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
