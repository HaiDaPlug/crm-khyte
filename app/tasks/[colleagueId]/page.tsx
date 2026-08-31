import { notFound } from 'next/navigation'
import { COLLEAGUE_IDS } from '@/lib/colleagues'
import type { ColleagueId } from '@/lib/types'
import { ColleagueTasksView } from './ColleagueTasksView'

export default async function ColleagueTasksPage({
  params,
}: {
  params: Promise<{ colleagueId: string }>
}) {
  const { colleagueId } = await params

  // The roster is the source of truth, same as /goals/display/[colleague] —
  // an unknown segment 404s rather than rendering an empty board.
  if (!COLLEAGUE_IDS.includes(colleagueId as ColleagueId)) {
    notFound()
  }

  return <ColleagueTasksView colleagueId={colleagueId as ColleagueId} />
}
