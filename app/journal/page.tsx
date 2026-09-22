'use client'

import { Topbar } from '@/components/layout/Topbar'
import { JournalComposer } from '@/components/journal/JournalComposer'
import { JournalFeed } from '@/components/journal/JournalFeed'
import { JournalSync } from '@/components/journal/JournalSync'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * The whole Journal, newest first.
 *
 * A client page like every other tab in this app (see /prospects, /tasks): the
 * layout has already read the session and built the store, and the Journal is
 * read per surface through Server Actions rather than with the page's own
 * server render — so there is nothing for a server component here to do that
 * the layout has not done.
 *
 * The composer above the feed rather than beside it: this page exists to be
 * written in, and the thing you came to do should not be below the thing you
 * came to read.
 */
export default function JournalPage() {
  const { t } = useTranslations()

  return (
    <>
      <Topbar />
      <JournalSync />
      <main className="min-w-0 flex-1 px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="mb-5">
            <h2 className="text-[26px] font-jakarta font-semibold tracking-[-0.02em] leading-none text-foreground sm:text-[30px]">
              {t.crm.journal.title}
            </h2>
          </div>

          <JournalComposer surface="journal" viewKey="journal" showOrganization className="mb-5" />

          <JournalFeed viewKey="journal" />
        </div>
      </main>
    </>
  )
}
