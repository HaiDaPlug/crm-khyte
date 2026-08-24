import { ColleagueId } from '@/lib/types'

export const COLLEAGUE_IDS: ColleagueId[] = ['erik', 'abdi', 'hai']

export interface Colleague {
  id: ColleagueId
  name: string
  /** Fixed hex, not a theme token — an avatar must read as the same color in
   *  light and dark mode, same reasoning as `priorityDot`. */
  color: string
}

export const colleagues: Record<ColleagueId, Colleague> = {
  erik: { id: 'erik', name: 'Erik', color: '#4C8BF5' },
  abdi: { id: 'abdi', name: 'Abdi', color: '#4CAF72' },
  hai: { id: 'hai', name: 'Hai', color: '#D4943C' },
}
