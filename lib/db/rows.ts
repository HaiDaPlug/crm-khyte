import type {
  ColleagueId,
  CrmEventKind,
  GoalSection,
  GoalStatus,
  MetricUnit,
  Priority,
  Stage,
} from '@/lib/types'

/**
 * The wire shape of each table, exactly as PostgREST returns it — snake_case,
 * nullable where the schema says nullable. Hand-written to match
 * supabase/migrations/20260819120000_init.sql plus the columns later
 * migrations added, most recently `organization_id` from
 * 20260920120000_organizations.sql; keep the two in step.
 *
 * Nothing outside lib/db should use these. The mappers translate them into the
 * camelCase domain types in lib/types that the components already speak.
 *
 * `organization_id` is on every row here and on none of the domain types, and
 * that asymmetry is the design. On the way in, ./mappers ignores it: a row's
 * organization is the reader's organization by construction, because every
 * query in ./queries filters by it, so carrying it into the store would repeat
 * one value a few hundred times. On the way out, the mappers do not set it
 * either: the value comes from the caller's AuthContext at the insert site
 * (see app/actions), never from a record the client sent — a client that could
 * name its own organization could name someone else's.
 *
 * `owner_id` is retired and was never populated. It stays in these shapes
 * because the column stays in the database — see the organizations migration
 * for why dropping a column the deployed code might still select is not a
 * change this CRM makes lightly.
 */

export interface CompanyRow {
  id: string
  owner_id: string | null
  organization_id: string
  name: string
  domain: string
  industry: string
  size: string
  location: string
  tags: string[]
  /** numeric(14,2) can arrive as a string, same as OpportunityRow.deal_value. */
  revenue: number | string | null
  employee_count: number | null
  about: string | null
  created_at: string
  updated_at: string
}

export interface ContactRow {
  id: string
  owner_id: string | null
  organization_id: string
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
  organization_id: string
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
  followed_up_by: ColleagueId | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface LeadRow {
  id: string
  owner_id: string | null
  organization_id: string
  company_name: string
  tags: string[]
  contact_name: string | null
  connection: string | null
  source: string | null
  followed_up_by: ColleagueId | null
  priority: Priority
  notes: string
  created_at: string
  updated_at: string
}

export interface StrategyBoardRow {
  id: string
  owner_id: string | null
  organization_id: string
  created_at: string
  updated_at: string
}

export interface StrategyBoardOpportunityRow {
  board_id: string
  opportunity_id: string
  organization_id: string
  created_at: string
}

export interface StrategyColumnRow {
  id: string
  owner_id: string | null
  organization_id: string
  board_id: string
  title: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface StrategyCardRow {
  id: string
  owner_id: string | null
  organization_id: string
  column_id: string
  content: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface GoalRow {
  id: string
  owner_id: string | null
  organization_id: string
  section: GoalSection
  title: string
  detail: string
  status: GoalStatus
  /** Retired — see the Goal type and 20260915120000_goal_metric_current.sql. */
  progress: number | null
  target_date: string | null
  metric_kind: CrmEventKind | null
  metric_current: number | null
  metric_target: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface GoalMetricRow {
  id: string
  owner_id: string | null
  organization_id: string
  label: string
  /** `numeric` arrives as a string over PostgREST and from postgres.js alike. */
  current_value: number | string
  target_value: number | string | null
  unit: MetricUnit
  sort_order: number
  created_at: string
  updated_at: string
}

export interface PersonalGoalRow {
  id: string
  owner_id: string | null
  organization_id: string
  colleague: ColleagueId
  title: string
  target_date: string | null
  progress: number | null
  done: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TaskRow {
  tags: string[]
  id: string
  owner_id: string | null
  organization_id: string
  title: string
  description: string | null
  related_opportunity_id: string | null
  related_company_id: string | null
  due_date: string | null
  completed: boolean
  priority: Priority
  assignee: ColleagueId | null
  archived_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}
