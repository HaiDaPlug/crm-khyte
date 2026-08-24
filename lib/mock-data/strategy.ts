import { StrategyCard, StrategyColumn } from '../types'

// Headlines belong to one opportunity — these are the Nordvik deal's lanes.
// Every other demo opportunity opens with an empty board, which is what a real
// new deal looks like.
export const mockStrategyColumns: StrategyColumn[] = [
  { id: 'sc1', opportunityId: 'o2', title: 'Pain Points', order: 0 },
  { id: 'sc2', opportunityId: 'o2', title: 'Stakeholders', order: 1 },
  { id: 'sc3', opportunityId: 'o2', title: 'Objections', order: 2 },
  { id: 'sc4', opportunityId: 'o2', title: 'Offer Angle', order: 3 },
  { id: 'sc5', opportunityId: 'o2', title: 'Proof', order: 4 },
  { id: 'sc6', opportunityId: 'o2', title: 'Next Actions', order: 5 },
]

export const mockStrategyCards: StrategyCard[] = [
  { id: 's1', opportunityId: 'o2', columnId: 'sc1', content: 'Manual vendor evaluation process taking 2 months', order: 0 },
  { id: 's2', opportunityId: 'o2', columnId: 'sc1', content: 'No unified view of spend across subsidiaries', order: 1 },
  { id: 's3', opportunityId: 'o2', columnId: 'sc2', content: 'Marcus Lindqvist — CFO (decision maker)', order: 0 },
  { id: 's4', opportunityId: 'o2', columnId: 'sc2', content: 'Anna Berg — VP Ops (influencer, daily user)', order: 1 },
  { id: 's5', opportunityId: 'o2', columnId: 'sc3', content: 'Price is 20% above current solution', order: 0 },
  { id: 's6', opportunityId: 'o2', columnId: 'sc3', content: 'Concerned about migration timeline', order: 1 },
  { id: 's7', opportunityId: 'o2', columnId: 'sc4', content: 'ROI on ops time savings: 40hrs/month recovered', order: 0 },
  { id: 's8', opportunityId: 'o2', columnId: 'sc5', content: 'Fenwick case study — similar size, same industry', order: 0 },
  { id: 's9', opportunityId: 'o2', columnId: 'sc6', content: 'Send SOC2 certificate and data portability doc', order: 0 },
  { id: 's10', opportunityId: 'o2', columnId: 'sc6', content: 'Book discovery call for Thursday', order: 1 },
]
