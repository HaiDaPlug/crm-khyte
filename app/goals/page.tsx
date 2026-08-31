import Link from 'next/link'
import { CalendarClock } from 'lucide-react'

import { Topbar } from '@/components/layout/Topbar'
import { GoalsEditor } from '@/components/goals/GoalsEditor'
import { WallpaperLinks } from '@/components/goals/WallpaperLinks'
import { requireSession } from '@/lib/auth/guard'
import { displayToken } from '@/lib/auth/display-token'
import { COLLEAGUE_IDS, colleagues } from '@/lib/colleagues'
import { loadGoals } from '@/lib/db/queries'

/**
 * The editable workspace. Company direction in, wallpapers out.
 *
 * Khyte-internal: this is the company operating layer sitting above the CRM,
 * not a CRM feature. If Intenti is ever sold to someone else, this module is
 * the part that stays home until a customer asks for it.
 */
export default async function GoalsPage() {
  // Proxy already turned away anyone without a session, but that is an
  // optimistic cookie check — this is the one that counts, same as every other
  // page that reads real data.
  await requireSession()

  const snapshot = await loadGoals()

  // Tokens are minted server-side and handed down as finished URLs. The secret
  // never crosses into the client bundle, which is the whole point of doing it
  // here rather than in the component.
  const links = COLLEAGUE_IDS.map((id) => ({
    id,
    name: colleagues[id].name,
    color: colleagues[id].color,
    token: displayToken(id),
  }))

  return (
    <>
      <Topbar />
      <main className="min-w-0 flex-1 px-4 py-5 animate-fade-in-up sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="mb-1 text-[26px] font-jakarta font-semibold leading-none tracking-[-0.02em] text-foreground sm:text-[30px]">
              Riktning
            </h2>
            <p className="text-[14.5px] text-foreground/55">
              Vad vi försöker uppnå. Ändringar här syns på allas bakgrundsbild.
            </p>
          </div>

          <Link
            href="/goals/timeline"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-raised px-3.5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-surface"
          >
            <CalendarClock size={14} />
            Tidslinje
          </Link>
        </div>

        <WallpaperLinks links={links} />

        <GoalsEditor initial={snapshot} />
      </main>
    </>
  )
}
