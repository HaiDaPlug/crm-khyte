'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  MessageSquare,
  Table2,
  Kanban,
  Target,
  Building2,
  Users,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCRMStore } from '@/lib/store'

const navItems = [
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/leads', label: 'Leads', icon: Table2 },
  { href: '/pipeline', label: 'Pipeline', icon: Kanban },
  { href: '/strategy', label: 'Strategy', icon: Target },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
]

export function AppSidebar() {
  const pathname = usePathname()
  const collapsed = useCRMStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useCRMStore((s) => s.toggleSidebar)

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 h-screen bg-surface border-r border-border flex flex-col z-30',
        'transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        collapsed ? 'w-16' : 'w-[232px]'
      )}
    >
      {/* Logo */}
      <div className="h-[52px] flex items-center px-4 border-b border-border shrink-0">
        <div className={cn(
          'flex items-center gap-2.5 overflow-hidden transition-all duration-300',
          collapsed ? 'w-8 justify-center' : 'w-full'
        )}>
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-background tracking-tight font-display">K</span>
          </div>
          <div className={cn(
            'flex items-baseline gap-1.5 overflow-hidden transition-all duration-300',
            collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <span className="text-[15px] font-semibold text-foreground tracking-tight whitespace-nowrap font-display">
              Khyte
            </span>
            <span className="text-[9px] font-mono text-muted uppercase tracking-[0.15em] whitespace-nowrap">
              CRM
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 relative group',
                  collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2',
                  isActive
                    ? 'text-foreground bg-accent-light'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised'
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-accent rounded-r-full" />
                )}
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2 : 1.5}
                  className={cn(
                    'shrink-0 transition-colors',
                    isActive ? 'text-accent' : 'text-muted group-hover:text-foreground-dim'
                  )}
                />
                <span className={cn(
                  'overflow-hidden whitespace-nowrap transition-all duration-300',
                  collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
                )}>
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className={cn(
          'mx-2 mb-2 flex items-center gap-2 rounded-lg text-[12px] text-muted hover:text-foreground hover:bg-surface-raised transition-all',
          collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
        )}
      >
        {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        <span className={cn(
          'overflow-hidden whitespace-nowrap transition-all duration-300',
          collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
        )}>
          Collapse
        </span>
      </button>

      {/* Footer */}
      <div className="shrink-0 px-3 py-3 border-t border-border">
        <div className={cn(
          'flex items-center gap-2.5 overflow-hidden',
          collapsed && 'justify-center'
        )}>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent/80 to-accent flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-background">K</span>
          </div>
          <div className={cn(
            'flex-1 min-w-0 overflow-hidden transition-all duration-300',
            collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <p className="text-[12px] font-medium text-foreground truncate">Workspace</p>
            <p className="text-[10.5px] text-muted truncate font-mono">khyte.io</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
