import { StrategyBoard, StrategyCard, StrategyColumn } from '../types'

// One demo board, linked to the Nordvik deal — everything below belongs to
// it. Every other demo opportunity has no board yet, which is what a real new
// deal looks like.
export const mockStrategyBoards: StrategyBoard[] = [{ id: 'sb1' }]

export const mockStrategyBoardOpportunities: { boardId: string; opportunityId: string }[] = [
  { boardId: 'sb1', opportunityId: 'o2' },
]

export const mockStrategyColumns: StrategyColumn[] = [
  { id: 'sc1', boardId: 'sb1', title: 'Pain Points', order: 0 },
  { id: 'sc2', boardId: 'sb1', title: 'Stakeholders', order: 1 },
  { id: 'sc3', boardId: 'sb1', title: 'Objections', order: 2 },
  { id: 'sc4', boardId: 'sb1', title: 'Offer Angle', order: 3 },
  { id: 'sc5', boardId: 'sb1', title: 'Proof', order: 4 },
  { id: 'sc6', boardId: 'sb1', title: 'Next Actions', order: 5 },
]

export const mockStrategyCards: StrategyCard[] = [
  { id: 's1', columnId: 'sc1', content: 'Manual vendor evaluation process taking 2 months', order: 0 },
  { id: 's2', columnId: 'sc1', content: 'No unified view of spend across subsidiaries', order: 1 },
  { id: 's3', columnId: 'sc2', content: 'Marcus Lindqvist — CFO (decision maker)', order: 0 },
  { id: 's4', columnId: 'sc2', content: 'Anna Berg — VP Ops (influencer, daily user)', order: 1 },
  { id: 's5', columnId: 'sc3', content: 'Price is 20% above current solution', order: 0 },
  { id: 's6', columnId: 'sc3', content: 'Concerned about migration timeline', order: 1 },
  { id: 's7', columnId: 'sc4', content: 'ROI on ops time savings: 40hrs/month recovered', order: 0 },
  { id: 's8', columnId: 'sc5', content: 'Fenwick case study — similar size, same industry', order: 0 },
  { id: 's9', columnId: 'sc6', content: 'Send SOC2 certificate and data portability doc', order: 0 },
  { id: 's10', columnId: 'sc6', content: 'Book discovery call for Thursday', order: 1 },
]
