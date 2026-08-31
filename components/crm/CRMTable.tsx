'use client'

import { useEffect, useRef, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  PaginationState,
} from '@tanstack/react-table'
import { ChevronsUpDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Opportunity, Company, Contact } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useFormat } from '@/lib/hooks/useFormat'
import { stageColors, priorityDot } from '@/lib/stage-config'
import { colleagues } from '@/lib/colleagues'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { useBoardPan } from '@/lib/hooks/useBoardPan'

export interface TableRow {
  opportunity: Opportunity
  company: Company
  contact: Contact
}

interface CRMTableProps {
  data: TableRow[]
  onRowClick: (row: TableRow) => void
}

const PAGE_SIZE = 10

/* Page numbers around the current one: 1 … 4 5 6 … 12. Everything fits
   without a gap up to 7 pages, so only pad once the list outgrows that. */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const wanted = [1, current - 1, current, current + 1, total]
    .filter((p, i, arr) => p >= 1 && p <= total && arr.indexOf(p) === i)
    .sort((a, b) => a - b)
  return wanted.flatMap((p, i) =>
    i > 0 && p - wanted[i - 1] > 1 ? ['gap' as const, p] : [p]
  )
}

export function CRMTable({ data, onRowClick }: CRMTableProps) {
  const { t } = useTranslations()
  const fmt = useFormat()
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE })
  const scrollRef = useRef<HTMLDivElement>(null)
  useBoardPan(scrollRef, { panExcludeSelector: 'tr, th' })

  const columns: ColumnDef<TableRow>[] = [
    {
      id: 'company',
      accessorFn: (row) => row.company.name,
      header: t.crm.table.company,
      cell: ({ row }) => (
        <div>
          <p className="text-[15px] font-medium text-foreground leading-tight">{row.original.company.name}</p>
          <p className="text-[13.5px] text-foreground/60 mt-0.5">{row.original.company.industry}</p>
        </div>
      ),
    },
    {
      id: 'contact',
      accessorFn: (row) => row.contact.name,
      header: t.crm.table.contact,
      cell: ({ row }) => (
        <div>
          <p className="text-[15px] text-foreground leading-tight">{row.original.contact.name}</p>
          <p className="text-[13.5px] text-foreground/60 mt-0.5">{row.original.contact.role}</p>
        </div>
      ),
    },
    {
      id: 'stage',
      accessorFn: (row) => row.opportunity.stage,
      header: t.crm.table.stage,
      cell: ({ row }) => (
        <span className={cn(
          'inline-flex items-center h-7 px-2.5 rounded-md text-[14px] font-medium',
          stageColors[row.original.opportunity.stage]
        )}>
          {t.stages[row.original.opportunity.stage]}
        </span>
      ),
    },
    {
      id: 'addedBy',
      accessorFn: (row) =>
        row.opportunity.followedUpBy ? colleagues[row.opportunity.followedUpBy].name : '',
      header: t.crm.table.addedBy,
      cell: ({ row }) => {
        const addedBy = row.original.opportunity.followedUpBy
        if (!addedBy) return <span className="text-[14px] text-foreground/40">—</span>
        const person = colleagues[addedBy]
        return (
          <div className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: person.color }}
            >
              {person.name.charAt(0)}
            </span>
            <span className="text-[14.5px] text-foreground/85">{person.name}</span>
          </div>
        )
      },
    },
    {
      id: 'priority',
      accessorFn: (row) => row.opportunity.priority,
      header: t.crm.table.priority,
      cell: ({ row }) => {
        const priority = row.original.opportunity.priority
        return (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: priorityDot[priority] }} />
            <span className="text-[14.5px] text-foreground/85">{t.priorities[priority]}</span>
          </div>
        )
      },
    },
    {
      id: 'dealValue',
      accessorFn: (row) => row.opportunity.dealValue ?? 0,
      header: t.crm.table.dealValue,
      cell: ({ row }) => {
        const val = row.original.opportunity.dealValue
        if (!val) return <span className="text-foreground/40 text-[15px]">—</span>
        return (
          <span className="text-[16px] font-semibold text-foreground tabular-nums">
            {fmt.currency(val)}
          </span>
        )
      },
    },
    {
      id: 'lastInteraction',
      accessorFn: (row) => row.opportunity.lastInteraction,
      header: t.crm.table.lastTouch,
      cell: ({ row }) => (
        <span className="text-[13.5px] text-foreground/65 font-mono tabular-nums">
          {fmt.date(row.original.opportunity.lastInteraction)}
        </span>
      ),
    },
    {
      id: 'nextStep',
      accessorFn: (row) => row.opportunity.nextStep,
      header: t.crm.table.nextStep,
      cell: ({ row }) => (
        <p className="text-[14.5px] text-foreground/85 max-w-[260px] truncate">
          {row.original.opportunity.nextStep}
        </p>
      ),
    },
    {
      id: 'followUpDate',
      accessorFn: (row) => row.opportunity.followUpDate,
      header: t.crm.table.followUp,
      cell: ({ row }) => {
        const date = row.original.opportunity.followUpDate
        if (!date) return <span className="text-foreground/40 text-[15px]">—</span>
        const isPast = new Date(date) < new Date()
        return (
          <span className={cn(
            'text-[13.5px] font-mono tabular-nums',
            isPast ? 'text-danger font-medium' : 'text-foreground/65'
          )}>
            {fmt.date(date)}
          </span>
        )
      },
    },
    {
      id: 'tags',
      accessorFn: (row) => row.opportunity.tags.join(', '),
      header: t.crm.table.tags,
      cell: ({ row }) => (
        <div className="flex flex-nowrap items-center gap-1.5">
          {row.original.opportunity.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[12.5px] font-mono px-2 py-0.5 bg-surface-raised text-foreground/80 border border-border-subtle rounded-md">
              {tag}
            </span>
          ))}
          {row.original.opportunity.tags.length > 2 && (
            <span className="text-[12.5px] text-foreground/60">+{row.original.opportunity.tags.length - 2}</span>
          )}
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // Editing a prospect re-creates the rows; TanStack's default would bounce
    // the user back to page 1 on every save. Clamp out-of-range pages instead.
    autoResetPageIndex: false,
  })

  const pageCount = table.getPageCount()

  useEffect(() => {
    if (pageCount > 0 && pagination.pageIndex > pageCount - 1) {
      setPagination(p => ({ ...p, pageIndex: pageCount - 1 }))
    }
  }, [pageCount, pagination.pageIndex])

  const currentPage = pagination.pageIndex + 1
  const firstOnPage = pagination.pageIndex * pagination.pageSize + 1
  const lastOnPage = Math.min(firstOnPage + pagination.pageSize - 1, data.length)

  const navButton = 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-border bg-surface px-2 text-foreground/70 transition-colors hover:border-border-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

  return (
    <div className="data-table">
      {pageCount > 1 && (
        <nav
          aria-label={t.crm.table.pagination}
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2 sm:px-4"
        >
          <span className="label-mono whitespace-nowrap tabular-nums">
            {t.crm.table.range(firstOnPage, lastOnPage, data.length)}
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label={t.crm.table.previousPage}
              className={navButton}
            >
              <ChevronLeft size={16} />
            </button>

            <span className="px-2 text-[14px] font-medium tabular-nums text-foreground/70 sm:hidden">
              {currentPage} / {pageCount}
            </span>

            <div className="hidden items-center gap-1 sm:flex">
              {pageWindow(currentPage, pageCount).map((page, i) =>
                page === 'gap' ? (
                  <span key={`gap-${i}`} className="px-1 text-[14px] text-foreground/40">
                    …
                  </span>
                ) : (
                  <button
                    key={page}
                    type="button"
                    onClick={() => table.setPageIndex(page - 1)}
                    aria-label={t.crm.table.goToPage(page)}
                    aria-current={page === currentPage ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-[14px] font-medium tabular-nums transition-colors',
                      page === currentPage
                        ? 'bg-accent text-background border-accent'
                        : 'bg-surface text-foreground/70 border-border hover:border-border-accent hover:text-foreground'
                    )}
                  >
                    {page}
                  </button>
                )
              )}
            </div>

            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label={t.crm.table.nextPage}
              className={navButton}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </nav>
      )}

      <div className="md:hidden">
        {table.getRowModel().rows.length > 0 ? (
          <ul role="list" className="space-y-2.5">
            {table.getRowModel().rows.map(row => {
              const { opportunity, company, contact } = row.original
              const followUpPast =
                !!opportunity.followUpDate && new Date(opportunity.followUpDate) < new Date()

              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onRowClick(row.original)}
                    className={cn(
                      'group block w-full overflow-hidden rounded-xl border border-border bg-surface p-4 text-left',
                      'touch-manipulation transition-[background-color,border-color,transform] duration-150',
                      'active:scale-[0.995] active:bg-surface-raised',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                    )}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[16px] font-semibold leading-tight text-foreground">
                          {company.name}
                        </span>
                        <span className="mt-1 block truncate text-[13.5px] text-foreground/65">
                          {company.industry || contact.role}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'inline-flex min-h-7 shrink-0 items-center rounded-md px-2.5 text-[13px] font-medium',
                          stageColors[opportunity.stage]
                        )}
                      >
                        {t.stages[opportunity.stage]}
                      </span>
                    </span>

                    <span className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-border-subtle pt-3.5">
                      <span className="min-w-0">
                        <span className="label-mono block">{t.crm.table.contact}</span>
                        <span className="mt-1 block truncate text-[14.5px] font-medium text-foreground">
                          {contact.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-foreground/60">
                          {contact.role}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="label-mono block">{t.crm.table.dealValue}</span>
                        <span className="mt-1 block text-[17px] font-semibold tabular-nums text-foreground">
                          {opportunity.dealValue ? fmt.currency(opportunity.dealValue) : '—'}
                        </span>
                      </span>
                    </span>

                    <span className="mt-3 block rounded-lg border border-border-accent bg-accent-light px-3 py-2.5">
                      <span className="label-mono block text-accent">{t.crm.table.nextStep}</span>
                      <span className="mt-1 block line-clamp-2 text-[14px] leading-relaxed text-foreground/85">
                        {opportunity.nextStep || '—'}
                      </span>
                    </span>

                    <span className="mt-3 flex items-end justify-between gap-3">
                      <span className="min-w-0">
                        <span className="label-mono block">{t.crm.table.followUp}</span>
                        <span
                          className={cn(
                            'mt-1 block font-mono text-[13.5px] tabular-nums',
                            followUpPast ? 'font-medium text-danger' : 'text-foreground/70'
                          )}
                        >
                          {opportunity.followUpDate ? fmt.date(opportunity.followUpDate) : '—'}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {opportunity.followedUpBy && (
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                            style={{ background: colleagues[opportunity.followedUpBy].color }}
                            title={colleagues[opportunity.followedUpBy].name}
                          >
                            {colleagues[opportunity.followedUpBy].name.charAt(0)}
                          </span>
                        )}
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: priorityDot[opportunity.priority] }}
                        />
                        <span className="text-[13px] capitalize text-foreground/75">
                          {t.priorities[opportunity.priority]}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-border bg-surface px-5 py-14 text-center">
            <p className="text-[15px] text-foreground/60">{t.crm.table.empty}</p>
          </div>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
        <div ref={scrollRef} className="board-scroll overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    className="px-6 py-3.5 text-left select-none bg-surface-raised/50"
                    onClick={header.column.getToggleSortingHandler()}
                    style={{ cursor: header.column.getCanSort() ? 'pointer' : 'default' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="label-mono whitespace-nowrap">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {header.column.getCanSort() && (
                        <span className="text-foreground/50">
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUp size={12} className="text-accent" />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ChevronDown size={12} className="text-accent" />
                          ) : (
                            <ChevronsUpDown size={12} />
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
                  <td key={cell.id} className="px-6 py-4 whitespace-nowrap align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {data.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-[15px] text-foreground/60">{t.crm.table.empty}</p>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
