export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type Stage =
  | 'New'
  | 'Researched'
  | 'Contacted'
  | 'Warm'
  | 'Meeting Booked'
  | 'Proposal Sent'
  | 'Negotiation'
  | 'Won'
  | 'Lost'

export interface Company {
  id: string
  name: string
  domain: string
  industry: string
  size: string
  location: string
  tags: string[]
}

export interface Contact {
  id: string
  companyId: string
  name: string
  role: string
  email: string
  linkedin?: string
  phone?: string
}

export interface Opportunity {
  id: string
  companyId: string
  contactId: string
  stage: Stage
  priority: Priority
  dealValue?: number
  nextStep: string
  followUpDate: string
  lastInteraction: string
  tags: string[]
  notes: string
}

export interface Note {
  id: string
  opportunityId?: string
  companyId?: string
  raw: string
  createdAt: string
  aiExtracted?: {
    company?: string
    contact?: string
    suggestedStage?: Stage
    painPoints?: string[]
    nextStep?: string
    followUpDate?: string
  }
  dismissed?: boolean
  applied?: boolean
}

export interface StrategyCard {
  id: string
  opportunityId: string
  column: StrategyColumn
  content: string
  order: number
}

export type StrategyColumn =
  | 'Pain Points'
  | 'Stakeholders'
  | 'Objections'
  | 'Offer Angle'
  | 'Proof'
  | 'Next Actions'

export type PipelineStage = Stage

export interface Task {
  id: string
  title: string
  description?: string
  relatedOpportunityId?: string
  relatedCompanyId?: string
  dueDate: string
  completed: boolean
  priority: Priority
  createdAt: string
}
