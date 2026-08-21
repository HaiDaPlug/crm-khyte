'use client'

import { useState, useRef, useEffect } from 'react'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { cn } from '@/lib/utils'
import { priorityDot } from '@/lib/stage-config'
import { ArrowRight, Circle, Flame, ListChecks, Mic, Send, Sparkles, TrendingUp } from 'lucide-react'
import { useTranslations } from '@/lib/hooks/useTranslations'

const STAGE_WEIGHT: Record<string, number> = {
  'New': 1, 'Researched': 2, 'Contacted': 3, 'Warm': 4,
  'Meeting Booked': 5, 'Proposal Sent': 6, 'Negotiation': 7, 'Won': 8, 'Lost': 0,
}

type ChatMessage = { role: 'user' | 'assistant'; text: string; id: string }

export default function DashboardPage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const tasks = useCRMStore((s) => s.tasks)
  const toggleTaskComplete = useCRMStore((s) => s.toggleTaskComplete)

  const openTasks = tasks.filter(t => !t.completed)
  const pipeline = opportunities
    .filter(o => o.stage !== 'Lost')
    .sort((a, b) => (STAGE_WEIGHT[b.stage] || 0) - (STAGE_WEIGHT[a.stage] || 0))
  const totalValue = pipeline.reduce((s, o) => s + (o.dealValue || 0), 0)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Time-aware greeting, set after mount so the static build doesn't bake in a stale hour
  const [greeting, setGreeting] = useState(t.dashboard.welcome)
  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(
      h < 5 ? t.dashboard.lateNight
      : h < 12 ? t.dashboard.goodMorning
      : h < 17 ? t.dashboard.goodAfternoon
      : h < 22 ? t.dashboard.goodEvening
      : t.dashboard.lateNight
    )
  }, [t])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function grow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 140) + 'px'
  }

  function send() {
    const text = input.trim()
    if (!text) return
    setMessages(prev => [...prev, { role: 'user', id: crypto.randomUUID(), text }])
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'

    setTimeout(() => {
      const l = text.toLowerCase()
      const reply =
        l.includes('sable') || l.includes('proposal') || l.includes('offert')
          ? t.dashboard.replies.sable(fmt.currency(75000))
          : l.includes('nordvik') || l.includes('discovery') || l.includes('kartlägg')
          ? t.dashboard.replies.nordvik(fmt.currency(120000))
          : l.includes('orin') || l.includes('legal') || l.includes('contract') || l.includes('avtal') || l.includes('juridik')
          ? t.dashboard.replies.orin(fmt.currency(200000))
          : l.includes('task') || l.includes('todo') || l.includes('uppgift')
          ? t.dashboard.replies.tasks
          : l.includes('pipeline') || l.includes('deal') || l.includes('affär')
          ? t.dashboard.replies.pipeline(
              fmt.currency(517000),
              fmt.currency(120000),
              fmt.currency(200000)
            )
          : t.dashboard.replies.focus
      setMessages(prev => [...prev, { role: 'assistant', id: crypto.randomUUID(), text: reply }])
    }, 500)
  }

  const satoshi = { fontFamily: "'Satoshi', var(--font-geist-sans), sans-serif" } as const
  const barlow = { fontFamily: 'var(--font-barlow)' } as const

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background" style={satoshi}>

      {/* ── Body: stacked cards left, chat right ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr] gap-8 px-8 pt-6 pb-6">

        {/* Left column — grainy cards stacked */}
        <div className="min-h-0 overflow-hidden flex flex-col justify-center gap-5 stagger-children">

          {/* Pipeline card */}
          <section className="grain-card shrink-0 px-6 py-7">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-baseline gap-3">
                <span className="text-[14px] uppercase tracking-[0.16em] text-foreground" style={{ ...barlow, fontWeight: 700 }}>
                  {t.dashboard.pipeline}
                </span>
                <span className="text-[14px] text-accent tabular-nums" style={{ ...barlow, fontWeight: 600 }}>
                  {fmt.currency(totalValue)}
                </span>
              </div>
              <a href="/pipeline" className="flex items-center gap-1 text-[14px] text-foreground-dim hover:text-foreground transition-colors">
                {t.dashboard.viewAll} <ArrowRight size={10} />
              </a>
            </div>

            {pipeline.slice(0, 3).map((opp, i) => {
              const company = companies.find(c => c.id === opp.companyId)
              const isLast = i === Math.min(pipeline.length, 3) - 1
              return (
                <div key={opp.id}>
                  <div className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg group hover:bg-surface-raised/50 transition-colors cursor-default">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityDot[opp.priority] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[17px] text-foreground" style={{ fontWeight: 500 }}>
                          {company?.name ?? '—'}
                        </span>
                        <span className="text-[13px] text-foreground-dim shrink-0">{t.stages[opp.stage]}</span>
                      </div>
                      <p className="text-[14px] text-foreground mt-0.5 truncate">{opp.nextStep}</p>
                    </div>
                    <span className="text-[16px] text-foreground shrink-0 tabular-nums" style={{ ...barlow, fontWeight: 600 }}>
                      {opp.dealValue ? fmt.currency(opp.dealValue) : '—'}
                    </span>
                  </div>
                  {!isLast && <div className="h-px bg-border-subtle" />}
                </div>
              )
            })}
            {pipeline.length > 3 && (
              <a href="/pipeline" className="flex items-center gap-1.5 mt-2.5 text-[14px] text-foreground-dim hover:text-foreground transition-colors">
                <ArrowRight size={10} /> {t.dashboard.seeMore(pipeline.length - 3)}
              </a>
            )}
          </section>

          {/* This Week card */}
          <section className="grain-card shrink-0 px-6 py-7">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-baseline gap-3">
                <span className="text-[14px] uppercase tracking-[0.16em] text-foreground" style={{ ...barlow, fontWeight: 700 }}>
                  {t.dashboard.thisWeek}
                </span>
                <span className="text-[14px] text-accent tabular-nums" style={{ ...barlow, fontWeight: 600 }}>
                  {openTasks.length} {t.dashboard.open}
                </span>
              </div>
              <a href="/tasks" className="flex items-center gap-1 text-[14px] text-foreground-dim hover:text-foreground transition-colors">
                {t.dashboard.allTasks} <ArrowRight size={10} />
              </a>
            </div>

            {openTasks.slice(0, 3).map((task, i) => {
              const isLast = i === Math.min(openTasks.length, 3) - 1
              return (
                <div key={task.id}>
                  <div className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg group hover:bg-surface-raised/50 transition-colors">
                    <button
                      onClick={() => toggleTaskComplete(task.id)}
                      className="shrink-0 w-4 h-4 rounded-full border border-border group-hover:border-accent flex items-center justify-center transition-all"
                    >
                      <Circle size={7} className="text-foreground-dim group-hover:text-accent transition-colors" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[17px] text-foreground truncate" style={{ fontWeight: 500 }}>{task.title}</p>
                      {task.description && (
                        <p className="text-[14px] text-foreground mt-0.5 truncate">{task.description}</p>
                      )}
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityDot[task.priority] }} />
                  </div>
                  {!isLast && <div className="h-px bg-border-subtle" />}
                </div>
              )
            })}
            {openTasks.length > 3 && (
              <a href="/tasks" className="flex items-center gap-1.5 mt-2.5 text-[14px] text-foreground-dim hover:text-foreground transition-colors">
                <ArrowRight size={10} /> {t.dashboard.seeMore(openTasks.length - 3)}
              </a>
            )}
          </section>
        </div>

        {/* Right column — chat, no card */}
        <div className="min-h-0 flex flex-col lg:border-l lg:border-border-subtle lg:pl-8">

          {messages.length === 0 ? (
            /* Empty state — greeting, composer, chips as one centered composition */
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center animate-fade-in pb-4 lg:pr-8">
              <h1 className="text-[50px] text-foreground font-headline tracking-tight mb-7">
                {greeting}.
              </h1>
              <div className="w-full max-w-[600px]">
                <Composer
                  inputRef={inputRef}
                  input={input}
                  setInput={setInput}
                  grow={grow}
                  send={send}
                  satoshi={satoshi}
                />
                <div className="flex flex-wrap justify-center gap-2.5 mt-4">
                  <Chips setInput={setInput} inputRef={inputRef} />
                </div>
              </div>
            </div>
          ) : (
          <>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mb-4 pr-1">
            {messages.map((msg) => (
            <div key={msg.id} className={cn('animate-fade-in-up', msg.role === 'user' && 'flex justify-end')}>
              {msg.role === 'assistant' ? (
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles size={9} className="text-accent" />
                  </div>
                  <p className="text-[14px] text-foreground leading-relaxed" style={{ fontWeight: 400 }}>
                    {msg.text}
                  </p>
                </div>
              ) : (
                <div className="max-w-[80%] bg-surface-raised rounded-2xl px-4 py-2.5">
                  <p className="text-[14px] text-foreground leading-relaxed" style={{ fontWeight: 400 }}>
                    {msg.text}
                  </p>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            <Chips setInput={setInput} inputRef={inputRef} />
          </div>

          <Composer
            inputRef={inputRef}
            input={input}
            setInput={setInput}
            grow={grow}
            send={send}
            satoshi={satoshi}
          />
          </>
          )}
        </div>
      </div>

    </div>
  )
}

interface ChipsProps {
  setInput: (v: string) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}

function Chips({ setInput, inputRef }: ChipsProps) {
  const { t } = useTranslations()
  const actions = [
    { label: t.dashboard.attentionPrompt, icon: Flame },
    { label: t.dashboard.pipelinePrompt, icon: TrendingUp },
    { label: t.dashboard.tasksPrompt, icon: ListChecks },
  ]
  return (
    <>
      {actions.map(({ label, icon: Icon }) => (
        <button
          key={label}
          onClick={() => { setInput(label); inputRef.current?.focus() }}
          className="flex items-center gap-2 text-[15px] font-medium text-foreground-dim bg-surface-raised rounded-xl px-5 py-2.5 hover:text-foreground transition-colors"
        >
          <Icon size={16} className="text-muted" />
          {label}
        </button>
      ))}
    </>
  )
}

interface ComposerProps {
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  grow: (el: HTMLTextAreaElement) => void
  send: () => void
  satoshi: React.CSSProperties
}

function Composer({ inputRef, input, setInput, grow, send, satoshi }: ComposerProps) {
  const { language, t } = useTranslations()
  const [listening, setListening] = useState(false)
  const recRef = useRef<{ stop: () => void } | null>(null)

  function toggleMic() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const w = window as unknown as Record<string, any>
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = language === 'sv' ? 'sv-SE' : 'en-US'
    rec.continuous = true
    rec.onresult = (e: any) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript
      }
      if (text) setInput(prev => (prev ? prev + ' ' : '') + text.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  return (
    <div className="rounded-[26px] bg-surface-raised px-6 py-5 focus-within:ring-1 focus-within:ring-accent/30 transition-shadow">
      <textarea
        ref={inputRef}
        value={input}
        onChange={e => { setInput(e.target.value); grow(e.target) }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        placeholder={t.dashboard.composerPlaceholder}
        rows={2}
        className="w-full min-h-[52px] resize-none bg-transparent text-[17px] text-foreground placeholder:text-muted outline-none overflow-hidden leading-relaxed"
        style={{ boxShadow: 'none', ...satoshi, fontWeight: 400 }}
      />
      <div className="h-px bg-border-subtle my-3.5" />
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted" style={satoshi}>
          {t.dashboard.composerHint}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleMic}
            title={listening ? t.dashboard.stopDictation : t.dashboard.dictate}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center transition-colors',
              listening
                ? 'text-accent bg-accent/15 animate-pulse'
                : 'text-muted hover:text-foreground hover:bg-background-raised'
            )}
          >
            <Mic size={15} />
          </button>
          <button
            onClick={send}
            disabled={!input.trim()}
            className="w-8 h-8 rounded-full bg-accent flex items-center justify-center disabled:opacity-20 hover:bg-accent-hover transition-colors"
          >
            <Send size={13} className="text-background" />
          </button>
        </div>
      </div>
    </div>
  )
}
