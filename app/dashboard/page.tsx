'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { cn } from '@/lib/utils'
import { priorityDot } from '@/lib/stage-config'
import { ArrowRight, Circle, Flame, ListChecks, Mic, Send, Sparkles, TrendingUp } from 'lucide-react'
import { useTranslations } from '@/lib/hooks/useTranslations'

const STAGE_WEIGHT: Record<string, number> = {
  'New': 1, 'Ongoing': 2, 'Contacted': 3, 'Warm': 4,
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
    <div
      className="flex min-h-[calc(100dvh_-_var(--mobile-topbar-height)_-_var(--mobile-bottomnav-height))] flex-col bg-background lg:h-screen lg:min-h-0 lg:overflow-hidden"
      style={satoshi}
    >

      {/* ── Body: stacked cards left, chat right ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[0.92fr_1.08fr] lg:gap-8 lg:px-8 lg:py-[clamp(12px,2vh,24px)]">

        {/* Left column — grainy cards stacked */}
        <div className="order-2 flex min-h-0 flex-col gap-4 overflow-visible stagger-children sm:gap-5 lg:order-1 lg:justify-center-safe lg:gap-[clamp(10px,1.7vh,20px)] lg:overflow-y-auto lg:overflow-x-hidden lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">

          {/* Pipeline card */}
          <section className="grain-card shrink-0 px-4 py-4 sm:px-5 lg:px-6 lg:py-[clamp(14px,2.2vh,28px)]">
            <div className="mb-2 flex items-center justify-between gap-3 lg:mb-[clamp(6px,1vh,12px)]">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-[14px] uppercase tracking-[0.16em] text-foreground" style={{ ...barlow, fontWeight: 700 }}>
                  {t.dashboard.pipeline}
                </span>
                <span className="text-[14px] text-accent tabular-nums" style={{ ...barlow, fontWeight: 600 }}>
                  {fmt.currency(totalValue)}
                </span>
              </div>
              <Link href="/pipeline" className="flex min-h-10 shrink-0 items-center gap-1 text-[13.5px] text-foreground/60 transition-colors hover:text-foreground">
                {t.dashboard.viewAll} <ArrowRight size={12} />
              </Link>
            </div>

            {pipeline.slice(0, 3).map((opp, i) => {
              const company = companies.find(c => c.id === opp.companyId)
              const isLast = i === Math.min(pipeline.length, 3) - 1
              return (
                <div key={opp.id}>
                  <div className="flex items-center gap-3 py-[clamp(7px,1.3vh,13px)] -mx-2 px-2 rounded-lg group hover:bg-surface-raised/50 transition-colors cursor-default">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityDot[opp.priority] }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[15px] text-foreground" style={{ fontWeight: 500 }}>
                          {company?.name ?? '—'}
                        </span>
                        <span className="text-[13.5px] text-foreground/60 shrink-0">{t.stages[opp.stage]}</span>
                      </div>
                      <p className="text-[13.5px] text-foreground/70 leading-snug truncate">{opp.nextStep}</p>
                    </div>
                    <span className="text-[15px] text-foreground shrink-0 tabular-nums" style={{ ...barlow, fontWeight: 600 }}>
                      {opp.dealValue ? fmt.currency(opp.dealValue) : '—'}
                    </span>
                  </div>
                  {!isLast && <div className="h-px bg-border-subtle" />}
                </div>
              )
            })}
            {pipeline.length > 3 && (
              <Link href="/pipeline" className="mt-1 flex min-h-10 items-center gap-1.5 text-[13.5px] text-foreground/60 transition-colors hover:text-foreground lg:mt-[clamp(5px,0.95vh,10px)]">
                <ArrowRight size={12} /> {t.dashboard.seeMore(pipeline.length - 3)}
              </Link>
            )}
          </section>

          {/* This Week card */}
          <section className="grain-card shrink-0 px-4 py-4 sm:px-5 lg:px-6 lg:py-[clamp(14px,2.2vh,28px)]">
            <div className="mb-2 flex items-center justify-between gap-3 lg:mb-[clamp(6px,1vh,12px)]">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-[14px] uppercase tracking-[0.16em] text-foreground" style={{ ...barlow, fontWeight: 700 }}>
                  {t.dashboard.thisWeek}
                </span>
                <span className="text-[14px] text-accent tabular-nums" style={{ ...barlow, fontWeight: 600 }}>
                  {openTasks.length} {t.dashboard.open}
                </span>
              </div>
              <Link href="/tasks" className="flex min-h-10 shrink-0 items-center gap-1 text-[13.5px] text-foreground/60 transition-colors hover:text-foreground">
                {t.dashboard.allTasks} <ArrowRight size={12} />
              </Link>
            </div>

            {openTasks.slice(0, 3).map((task, i) => {
              const isLast = i === Math.min(openTasks.length, 3) - 1
              return (
                <div key={task.id}>
                  <div className="flex items-center gap-3 py-[clamp(7px,1.3vh,13px)] -mx-2 px-2 rounded-lg group hover:bg-surface-raised/50 transition-colors">
                    <button
                      onClick={() => toggleTaskComplete(task.id)}
                      aria-label={task.title}
                      className="-m-2 flex size-10 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:text-accent"
                    >
                      <span className="flex size-4 items-center justify-center rounded-full border border-border transition-colors group-hover:border-accent">
                        <Circle size={7} className="transition-colors" />
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] text-foreground truncate" style={{ fontWeight: 500 }}>{task.title}</p>
                      {task.description && (
                        <p className="text-[13.5px] text-foreground/70 leading-snug truncate">{task.description}</p>
                      )}
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityDot[task.priority] }} />
                  </div>
                  {!isLast && <div className="h-px bg-border-subtle" />}
                </div>
              )
            })}
            {openTasks.length > 3 && (
              <Link href="/tasks" className="mt-1 flex min-h-10 items-center gap-1.5 text-[13.5px] text-foreground/60 transition-colors hover:text-foreground lg:mt-[clamp(5px,0.95vh,10px)]">
                <ArrowRight size={12} /> {t.dashboard.seeMore(openTasks.length - 3)}
              </Link>
            )}
          </section>
        </div>

        {/* Right column — chat, no card */}
        <div className="order-1 flex min-h-0 flex-col lg:order-2 lg:border-l lg:border-border-subtle lg:pl-8">

          {messages.length === 0 ? (
            /* Empty state — greeting, composer, chips as one centered composition */
            <div className="flex min-h-0 flex-1 flex-col items-stretch justify-start animate-fade-in pb-1 sm:pb-3 lg:items-center lg:justify-center lg:pb-4 lg:pr-8">
              <h1 className="mb-5 text-balance text-[clamp(34px,10vw,50px)] leading-[0.98] tracking-tight text-foreground font-headline lg:mb-7">
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
                <div className="-mx-1 mt-3 flex snap-x snap-proximity gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:justify-center sm:overflow-visible lg:mt-4 lg:gap-2.5">
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

          <div className="mb-3 flex snap-x snap-proximity gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
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
          className="flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-xl bg-surface-raised px-4 py-2 text-[13.5px] font-medium text-foreground/70 transition-colors hover:text-foreground sm:px-5 sm:text-[15px]"
        >
          <Icon size={16} className="text-foreground/60" />
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
    <div className="sticky bottom-2 z-10 rounded-[22px] bg-surface-raised px-4 py-4 shadow-[0_12px_36px_-24px_rgba(0,0,0,0.8)] transition-shadow focus-within:ring-1 focus-within:ring-accent/30 sm:px-5 lg:static lg:rounded-[26px] lg:px-6 lg:py-5 lg:shadow-none">
      <textarea
        ref={inputRef}
        value={input}
        onChange={e => { setInput(e.target.value); grow(e.target) }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        placeholder={t.dashboard.composerPlaceholder}
        rows={2}
        className="min-h-[48px] w-full resize-none overflow-hidden bg-transparent text-[16px] leading-relaxed text-foreground outline-none placeholder:text-foreground/45 sm:min-h-[52px] sm:text-[17px]"
        style={{ boxShadow: 'none', ...satoshi, fontWeight: 400 }}
      />
      <div className="h-px bg-border-subtle my-3.5" />
      <div className="flex items-center justify-between">
        <span className="max-w-[210px] truncate text-[12px] text-foreground/60 sm:max-w-none sm:text-[13px]" style={satoshi}>
          {t.dashboard.composerHint}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleMic}
            title={listening ? t.dashboard.stopDictation : t.dashboard.dictate}
            aria-label={listening ? t.dashboard.stopDictation : t.dashboard.dictate}
            className={cn(
              'flex size-11 items-center justify-center rounded-full transition-colors sm:size-9',
              listening
                ? 'text-accent bg-accent/15 animate-pulse'
                : 'text-foreground/60 hover:text-foreground hover:bg-background-raised'
            )}
          >
            <Mic size={15} />
          </button>
          <button
            onClick={send}
            disabled={!input.trim()}
            aria-label={t.dashboard.composerPlaceholder}
            className="flex size-11 items-center justify-center rounded-full bg-accent transition-colors hover:bg-accent-hover disabled:opacity-20 sm:size-9"
          >
            <Send size={13} className="text-background" />
          </button>
        </div>
      </div>
    </div>
  )
}
