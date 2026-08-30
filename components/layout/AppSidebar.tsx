'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Sparkles,
  Table2,
  Kanban,
  Target,
  Compass,
  Building2,
  Users,
  CheckSquare,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Sun,
  Moon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCRMStore } from '@/lib/store'
import khyteLogo from '@/public/khyte-logo-text-png.png'
import { useTranslations } from '@/lib/hooks/useTranslations'

export const navItems = [
  { href: '/dashboard', label: 'dashboard', icon: LayoutDashboard },
  { href: '/leads', label: 'leads', icon: Sparkles },
  { href: '/prospects', label: 'prospects', icon: Table2 },
  { href: '/pipeline', label: 'pipeline', icon: Kanban },
  { href: '/strategy', label: 'strategy', icon: Target },
  { href: '/goals', label: 'goals', icon: Compass },
  { href: '/companies', label: 'companies', icon: Building2 },
  { href: '/contacts', label: 'contacts', icon: Users },
  { href: '/tasks', label: 'tasks', icon: CheckSquare },
  { href: '/settings', label: 'settings', icon: Settings },
] as const

export function AppSidebar() {
  const { t } = useTranslations()
  const pathname = usePathname()
  const collapsed = useCRMStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useCRMStore((s) => s.toggleSidebar)
  const theme = useCRMStore((s) => s.settings.theme)
  const toggleTheme = useCRMStore((s) => s.toggleTheme)

  return (
    <aside
      data-theme="dark"
      className={cn(
        'fixed top-0 left-0 h-dvh grain-nav hidden lg:flex flex-col z-30',
        'transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
        collapsed ? 'w-16' : 'w-[232px]'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'h-[52px] flex items-center border-b border-border-accent shrink-0 transition-all duration-300',
        collapsed ? 'px-2 justify-center' : 'px-4'
      )}>
        {/* Clipped to the K mark when collapsed, full lockup when expanded */}
        <div className={cn(
          'h-9 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          collapsed ? 'w-[32px]' : 'w-[84px]'
        )}>
          <Image
            src={khyteLogo}
            alt="Khyte"
            width={84}
            height={36}
            preload
            className="h-9 w-[84px] max-w-none"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            const translatedLabel = t.nav[label]
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? translatedLabel : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg text-[15px] font-medium transition-all duration-150 relative group',
                  collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2',
                  isActive
                    ? 'text-foreground bg-accent-light'
                    : 'text-foreground hover:text-foreground hover:bg-surface-raised'
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
                  {translatedLabel}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
        className={cn(
          'mx-2 flex items-center gap-2 rounded-lg text-[14px] text-muted hover:text-foreground hover:bg-surface-raised transition-all',
          collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
        )}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        <span className={cn(
          'overflow-hidden whitespace-nowrap transition-all duration-300',
          collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
        )}>
          {theme === 'dark' ? t.nav.lightMode : t.nav.darkMode}
        </span>
      </button>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        aria-expanded={!collapsed}
        className={cn(
          'mx-2 mb-2 flex items-center gap-2 rounded-lg text-[14px] text-muted hover:text-foreground hover:bg-surface-raised transition-all',
          collapsed ? 'px-0 py-2 justify-center' : 'px-3 py-2'
        )}
      >
        {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        <span className={cn(
          'overflow-hidden whitespace-nowrap transition-all duration-300',
          collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
        )}>
          {t.nav.collapse}
        </span>
      </button>
    </aside>
  )
}
