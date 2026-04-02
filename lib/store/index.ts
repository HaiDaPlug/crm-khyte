import { create } from 'zustand'
import {
  Opportunity,
  Company,
  Contact,
  Note,
  StrategyCard,
  Task,
  Stage,
  StrategyColumn,
  Priority,
} from '@/lib/types'
import { mockOpportunities } from '@/lib/mock-data/opportunities'
import { mockCompanies } from '@/lib/mock-data/companies'
import { mockContacts } from '@/lib/mock-data/contacts'
import { mockNotes } from '@/lib/mock-data/notes'
import { mockStrategyCards } from '@/lib/mock-data/strategy'
import { mockTasks } from '@/lib/mock-data/tasks'

interface CRMStore {
  // Data
  opportunities: Opportunity[]
  companies: Company[]
  contacts: Contact[]
  notes: Note[]
  strategyCards: StrategyCard[]
  tasks: Task[]

  // UI state
  sidebarCollapsed: boolean
  searchQuery: string

  // Actions — Opportunities
  moveOpportunityStage: (opportunityId: string, newStage: Stage) => void
  updateOpportunity: (opportunityId: string, updates: Partial<Opportunity>) => void

  // Actions — Notes
  addNote: (note: Note) => void
  dismissNote: (noteId: string) => void
  applyNote: (noteId: string) => void

  // Actions — Strategy
  moveStrategyCard: (cardId: string, newColumn: StrategyColumn) => void
  addStrategyCard: (card: StrategyCard) => void

  // Actions — Tasks
  addTask: (task: Task) => void
  toggleTaskComplete: (taskId: string) => void
  updateTask: (taskId: string, updates: Partial<Task>) => void

  // Actions — Companies & Contacts
  addCompany: (company: Company) => void
  addContact: (contact: Contact) => void

  // Actions — UI
  toggleSidebar: () => void
  setSearchQuery: (query: string) => void
}

export const useCRMStore = create<CRMStore>((set) => ({
  // Seed with mock data
  opportunities: mockOpportunities,
  companies: mockCompanies,
  contacts: mockContacts,
  notes: mockNotes,
  strategyCards: mockStrategyCards,
  tasks: mockTasks,

  // UI defaults
  sidebarCollapsed: false,
  searchQuery: '',

  // Opportunities
  moveOpportunityStage: (opportunityId, newStage) =>
    set((state) => ({
      opportunities: state.opportunities.map((o) =>
        o.id === opportunityId ? { ...o, stage: newStage } : o
      ),
    })),

  updateOpportunity: (opportunityId, updates) =>
    set((state) => ({
      opportunities: state.opportunities.map((o) =>
        o.id === opportunityId ? { ...o, ...updates } : o
      ),
    })),

  // Notes
  addNote: (note) =>
    set((state) => ({ notes: [note, ...state.notes] })),

  dismissNote: (noteId) =>
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === noteId ? { ...n, dismissed: true } : n
      ),
    })),

  applyNote: (noteId) =>
    set((state) => {
      const note = state.notes.find((n) => n.id === noteId)
      if (!note?.aiExtracted) return state

      const ai = note.aiExtracted
      let opportunities = state.opportunities

      // If the note references a company, try to find and update the matching opportunity
      if (ai.company) {
        const company = state.companies.find(
          (c) => c.name.toLowerCase() === ai.company!.toLowerCase()
        )
        if (company) {
          const opp = opportunities.find((o) => o.companyId === company.id)
          if (opp) {
            opportunities = opportunities.map((o) =>
              o.id === opp.id
                ? {
                    ...o,
                    ...(ai.suggestedStage && { stage: ai.suggestedStage }),
                    ...(ai.nextStep && { nextStep: ai.nextStep }),
                    ...(ai.followUpDate && { followUpDate: ai.followUpDate }),
                  }
                : o
            )
          }
        }
      }

      return {
        opportunities,
        notes: state.notes.map((n) =>
          n.id === noteId ? { ...n, applied: true } : n
        ),
      }
    }),

  // Strategy
  moveStrategyCard: (cardId, newColumn) =>
    set((state) => ({
      strategyCards: state.strategyCards.map((c) =>
        c.id === cardId ? { ...c, column: newColumn } : c
      ),
    })),

  addStrategyCard: (card) =>
    set((state) => ({ strategyCards: [...state.strategyCards, card] })),

  // Tasks
  addTask: (task) =>
    set((state) => ({ tasks: [task, ...state.tasks] })),

  toggleTaskComplete: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, completed: !t.completed } : t
      ),
    })),

  updateTask: (taskId, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      ),
    })),

  // Companies & Contacts
  addCompany: (company) =>
    set((state) => ({ companies: [...state.companies, company] })),

  addContact: (contact) =>
    set((state) => ({ contacts: [...state.contacts, contact] })),

  // UI
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSearchQuery: (query) => set({ searchQuery: query }),
}))
