'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useCRMStore } from '@/lib/store'
import { useFormat } from '@/lib/hooks/useFormat'
import { priorityDot } from '@/lib/stage-config'
import { ArrowRight, Circle } from 'lucide-react'
import { JournalComposer } from '@/components/journal/JournalComposer'
import { JournalFeed } from '@/components/journal/JournalFeed'
import { JournalSync } from '@/components/journal/JournalSync'
import { useTranslations } from '@/lib/hooks/useTranslations'

const STAGE_WEIGHT: Record<string, number> = {
  'New': 1, 'Ongoing': 2, 'Contacted': 3, 'Warm': 4,
  'Meeting Booked': 5, 'Proposal Sent': 6, 'Negotiation': 7, 'Won': 8, 'Lost': 0,
}

export default function DashboardPage() {
  const { t } = useTranslations()
  const fmt = useFormat()
  const opportunities = useCRMStore((s) => s.opportunities)
  const companies = useCRMStore((s) => s.companies)
  const tasks = useCRMStore((s) => s.tasks)
  const toggleTaskComplete = useCRMStore((s) => s.toggleTaskComplete)
  const displayName = useCRMStore((s) => s.workspace.viewer.displayName)

  // Greet by first name. The roster's display name is how the team knows the
  // person ("Hai Pham Bui"); a 50px headline has room for how they are
  // addressed. Falls back to the whole name when there is no space to split on.
  const firstName = displayName.trim().split(/\s+/)[0] || displayName

  const openTasks = tasks.filter(t => !t.completed)
  const pipeline = opportunities
    .filter(o => o.stage !== 'Lost')
    .sort((a, b) => (STAGE_WEIGHT[b.stage] || 0) - (STAGE_WEIGHT[a.stage] || 0))
  const totalValue = pipeline.reduce((s, o) => s + (o.dealValue || 0), 0)

  // Time-aware greeting, set after mount so the static build doesn't bake in a stale hour
  const [greeting, setGreeting] = useState(() => t.dashboard.welcome(firstName))
  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(
      h < 5 ? t.dashboard.lateNight(firstName)
      : h < 12 ? t.dashboard.goodMorning(firstName)
      : h < 17 ? t.dashboard.goodAfternoon(firstName)
      : h < 22 ? t.dashboard.goodEvening(firstName)
      : t.dashboard.lateNight(firstName)
    )
  }, [t, firstName])

  const satoshi = { fontFamily: "'Satoshi', var(--font-geist-sans), sans-serif" } as const
  const barlow = { fontFamily: 'var(--font-barlow)' } as const

  return (
    <div
      className="flex min-h-[calc(100dvh_-_var(--mobile-topbar-height)_-_var(--mobile-bottomnav-height))] flex-col bg-background lg:h-screen lg:min-h-0 lg:overflow-hidden"
      style={satoshi}
    >

      {/* ── Body: stacked cards left, the Journal right ── */}
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

        {/* Right column — the greeting, the Journal box, and what was written
            most recently. What stood here was a chat panel with a scripted
            reply for six hard-coded company names: it answered a question
            nobody could ask twice and wrote nothing down anywhere. This box
            writes to Postgres (decision 9). */}
        <div className="order-1 flex min-h-0 flex-col lg:order-2 lg:border-l lg:border-border-subtle lg:pl-8">
          <JournalSync />

          <div className="flex min-h-0 flex-1 flex-col justify-start animate-fade-in pb-1 sm:pb-3 lg:justify-center lg:pb-4 lg:pr-8">
            <h1 className="mb-5 text-balance text-[clamp(34px,10vw,50px)] leading-[0.98] tracking-tight text-foreground font-headline lg:mb-7">
              {greeting}.
            </h1>

            <div className="w-full max-w-[600px]">
              <JournalComposer surface="dashboard" viewKey="dashboard" showOrganization />

              <div className="mt-5 min-h-0 lg:overflow-y-auto lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <span
                    className="text-[14px] uppercase tracking-[0.16em] text-foreground"
                    style={{ ...barlow, fontWeight: 700 }}
                  >
                    {t.dashboard.recent}
                  </span>
                  <Link
                    href="/journal"
                    className="flex min-h-10 shrink-0 items-center gap-1 text-[13.5px] text-foreground/60 transition-colors hover:text-foreground"
                  >
                    {t.dashboard.openJournal} <ArrowRight size={12} />
                  </Link>
                </div>
                {/* Five, not thirty: this is the last thing anybody wrote, not
                    the Journal. /journal is one click away and says so. */}
                <JournalFeed viewKey="dashboard" limit={5} />
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
