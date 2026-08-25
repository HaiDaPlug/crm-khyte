import { Lead } from '../types'

export const mockLeads: Lead[] = [
  {
    id: 'l1',
    companyName: 'Halcyon Robotics',
    contactName: 'Freja Lindberg',
    connection: 'Abdi knows their Head of Ops from a previous role',
    source: 'Trade show',
    priority: 'medium',
    notes: 'Spotted at a trade show — worth a cold outreach next quarter.',
    createdAt: '2026-08-10T09:00:00.000Z',
  },
  {
    id: 'l2',
    companyName: 'Fjord Analytics',
    priority: 'high',
    notes: '',
    createdAt: '2026-08-15T14:30:00.000Z',
  },
]
