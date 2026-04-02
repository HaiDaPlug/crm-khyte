'use client'

import { useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  SortingState,
} from '@tanstack/react-table'
import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { Opportunity, Company, Contact, Priority, Stage } from '@/lib/types'
import { cn } from '@/lib/utils'

const priorityConfig: Record<Priority, { dot: string; label: string }> = {
  critical: { dot: 'bg-red-500', label: 'Critical' },
  high: { dot: 'bg-accent', label: 'High' },
  medium: { dot: 'bg-blue-400', label: 'Medium' },
  low: { dot: 'bg-muted', label: 'Low' },
}

const stageColors: Record<Stage, string> = {
  'New': 'bg-surface-raised text-foreground-dim',
  'Researched': 'bg-blue-500/10 text-blue-400',
  'Contacted': 'bg-sky-500/10 text-sky-400',
  'Warm': 'bg-orange-500/10 text-orange-400',
  'Meeting Booked': 'bg-violet-500/10 text-violet-400',
  'Proposal Sent': 'bg-amber-500/10 text-amber-400',
  'Negotiation': 'bg-yellow-500/10 text-yellow-400',
  'Won': 'bg-success-muted text-success',
  'Lost': 'bg-danger-muted text-danger',
}

export interface TableRow {
  opportunity: Opportunity
  company: Company
  contact: Contact
}

interface CRMTableProps {
  data: TableRow[]
  onRowClick: (row: TableRow) => void
}

export function CRMTable({ data, onRowClick }: CRMTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])

  const columns: ColumnDef<TableRow>[] = [
    {
      id: 'company',
      accessorFn: (row) => row.company.name,
      header: 'Company',
      cell: ({ row }) => (
        <div>
          <p className="text-[13px] font-medium text-foreground">{row.original.company.name}</p>
          <p className="text-[11px] text-muted">{row.original.company.industry}</p>
        </div>
      ),
    },
    {
      id: 'contact',
      accessorFn: (row) => row.contact.name,
      header: 'Contact',
      cell: ({ row }) => (
        <div>
          <p className="text-[13px] text-foreground">{row.original.contact.name}</p>
          <p className="text-[11px] text-muted">{row.original.contact.role}</p>
        </div>
      ),
    },
    {
      id: 'stage',
      accessorFn: (row) => row.opportunity.stage,
      header: 'Stage',
      cell: ({ row }) => (
        <span className={cn(
          'inline-flex text-[10.5px] font-medium px-2 py-0.5 rounded-md',
          stageColors[row.original.opportunity.stage]
        )}>
          {row.original.opportunity.stage}
        </span>
      ),
    },
    {
      id: 'priority',
      accessorFn: (row) => row.opportunity.priority,
      header: 'Priority',
      cell: ({ row }) => {
        const p = priorityConfig[row.original.opportunity.priority]
        return (
          <div className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full shrink-0', p.dot)} />
            <span className="text-[12px] text-muted-foreground">{p.label}</span>
          </div>
        )
      },
    },
    {
      id: 'dealValue',
      accessorFn: (row) => row.opportunity.dealValue ?? 0,
      header: 'Deal Value',
      cell: ({ row }) => {
        const val = row.original.opportunity.dealValue
        if (!val) return <span className="text-muted text-[13px]">—</span>
        return (
          <span className="text-[13px] text-foreground font-medium tabular-nums">
            ${val.toLocaleString()}
          </span>
        )
      },
    },
    {
      id: 'lastInteraction',
      accessorFn: (row) => row.opportunity.lastInteraction,
      header: 'Last Touch',
      cell: ({ row }) => (
        <span className="text-[11px] text-muted font-mono">
          {row.original.opportunity.lastInteraction}
        </span>
      ),
    },
    {
      id: 'nextStep',
      accessorFn: (row) => row.opportunity.nextStep,
      header: 'Next Step',
      cell: ({ row }) => (
        <p className="text-[12px] text-muted-foreground max-w-[200px] truncate">
          {row.original.opportunity.nextStep}
        </p>
      ),
    },
    {
      id: 'followUpDate',
      accessorFn: (row) => row.opportunity.followUpDate,
      header: 'Follow-up',
      cell: ({ row }) => {
        const date = row.original.opportunity.followUpDate
        const isPast = new Date(date) < new Date()
        return (
          <span className={cn(
            'text-[11px] font-mono',
            isPast ? 'text-danger font-medium' : 'text-muted'
          )}>
            {date}
          </span>
        )
      },
    },
    {
      id: 'tags',
      accessorFn: (row) => row.opportunity.tags.join(', '),
      header: 'Tags',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.opportunity.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[9.5px] font-mono px-1.5 py-0.5 bg-surface-raised text-muted border border-border-subtle rounded-md">
              {tag}
            </span>
          ))}
          {row.original.opportunity.tags.length > 2 && (
            <span className="text-[10px] text-muted">+{row.original.opportunity.tags.length - 2}</span>
          )}
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className="px-4 py-2.5 text-left select-none bg-surface-raised/50"
                    onClick={header.column.getToggleSortingHandler()}
                    style={{ cursor: header.column.getCanSort() ? 'pointer' : 'default' }}
                  >
                    <div className="flex items-center gap-1">
                      <span className="label-mono whitespace-nowrap">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {header.column.getCanSort() && (
                        <span className="text-muted/40">
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUp size={11} className="text-accent" />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ChevronDown size={11} className="text-accent" />
                          ) : (
                            <ChevronsUpDown size={11} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.original)}
                className="border-b border-border-subtle last:border-0 hover:bg-accent-light cursor-pointer transition-colors duration-100"
              >
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {data.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-[13px] text-muted">No leads match the current filters.</p>
          </div>
        )}
      </div>
    </div>
  )
}
