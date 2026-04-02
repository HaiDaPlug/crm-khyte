import { Note } from '../types'

export const mockNotes: Note[] = [
  {
    id: 'n1',
    companyId: 'c1',
    raw: 'Called Elena this morning. She mentioned their Q2 budget is locked in and they need something deployed before June. Pain is around manual reporting — their ops team spends 3 days a month on it. She wants a demo for the exec team next week.',
    createdAt: '2026-03-24T10:32:00Z',
    aiExtracted: {
      company: 'Meridian Labs',
      contact: 'Elena Hartmann',
      suggestedStage: 'Warm',
      painPoints: ['Manual reporting taking 3 days/month', 'Q2 deadline pressure'],
      nextStep: 'Book exec team demo for next week',
      followUpDate: '2026-03-31',
    },
  },
  {
    id: 'n2',
    raw: 'Nordvik — Marcus mentioned they tried a competitor last year and it was a disaster. Migration issues. Wants to know about our data portability story. Also asked about SOC2.',
    createdAt: '2026-03-22T14:15:00Z',
    aiExtracted: {
      company: 'Nordvik Capital',
      contact: 'Marcus Lindqvist',
      suggestedStage: 'Meeting Booked',
      painPoints: ['Bad experience with competitor', 'Data portability concerns', 'SOC2 requirement'],
      nextStep: 'Prepare data portability one-pager and SOC2 cert',
    },
  },
  {
    id: 'n3',
    raw: 'random thought — should we build a lighter tier for smb? seems like we keep losing deals under 10k because pricing is too high. talk to the team about this.',
    createdAt: '2026-03-25T09:00:00Z',
  },
]
