import type { ColleagueId, Priority, Stage } from '@/lib/types'

/**
 * The wire shape of each table, exactly as PostgREST returns it — snake_case,
 * nullable where the schema says nullable. Hand-written to match
 * supabase/migrations/20260819120000_init.sql; keep the two in step.
 *
 * Nothing outside lib/db should use these. The mappers translate them into the
 * camelCase domain types in lib/types that the components already speak.
 */

export interface CompanyRow {
  id: string
  owner_id: string | null
  name: string
  domain: string
  industry: string
  size: string
  location: string
  tags: string[]
  created_at: string
  updated_at: string
}

export interface ContactRow {
  id: string
  owner_id: string | null
  company_id: string
  name: string
  role: string
  email: string
  linkedin: string | null
  phone: string | null
  created_at: string
  updated_at: string
}

export interface OpportunityRow {
  id: string
  owner_id: string | null
  company_id: string
  contact_id: string
  stage: Stage
  priority: Priority
  in_pipeline: boolean
  deal_value: number | string | null
  next_step: string
  follow_up_date: string | null
  last_interaction: string | null
  tags: string[]
  notes: string
  created_at: string
  updated_at: string
}

export interface NoteRow {
  id: string
  owner_id: string | null
  opportunity_id: string | null
  company_id: string | null
  raw: string
  ai_extracted: Record<string, unknown> | null
  dismissed: boolean
  applied: boolean
  created_at: string
  updated_at: string
}

export interface StrategyColumnRow {
  id: string
  owner_id: string | null
  opportunity_id: string
  title: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface StrategyCardRow {
  id: string
  owner_id: string | null
  opportunity_id: string
  column_id: string
  content: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TaskRow {
  id: string
  owner_id: string | null
  title: string
  description: string | null
  related_opportunity_id: string | null
  related_company_id: string | null
  due_date: string | null
  completed: boolean
  priority: Priority
  assignee: ColleagueId | null
  archived_at: string | null
  created_at: string
  updated_at: string
}
