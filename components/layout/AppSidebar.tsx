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
  CheckSquare,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { colleagues } from '@/lib/colleagues'
import type { ColleagueId } from '@/lib/types'
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
  { href: '/tasks', label: 'tasks', icon: CheckSquare },
  { href: '/settings', label: 'settings', icon: Settings },
] as const

/**
 * A member's initial on a disc.
 *
 * Takes the roster colour when an owner has mapped the person to a label, so
 * the avatar in the chrome is the same disc that sits on their tasks and
 * prospects (see AssigneePicker), and the accent otherwise. Fixed hex for the
 * roster colours — same reasoning as lib/colleagues: an avatar must read as
 * the same colour in light and dark mode.
 *
 * Exported for the mobile drawer and Settings, which show the same people;
 * one definition so the three cannot drift. Decorative — callers put the name
 * in text beside it.
 */
export function MemberAvatar({
  name,
  colleague,
  className,
}: {
  name: string
  colleague?: ColleagueId
  className?: string
}) {
  const person = colleague ? colleagues[colleague] : null
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full font-bold',
        person ? 'text-white' : 'bg-accent text-background',
        className
      )}
      style={person ? { background: person.color } : undefined}
    >
      {initial}
    </span>
  )
}

export function AppSidebar() {
  const { t } = useTranslations()
  const pathname = usePathname()
  const collapsed = useCRMStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useCRMStore((s) => s.toggleSidebar)
  const theme = useCRMStore((s) => s.settings.theme)
  const toggleTheme = useCRMStore((s) => s.toggleTheme)
  const viewer = useCRMStore((s) => s.workspace.viewer)
  const organization = useCRMStore((s) => s.workspace.organization)

  const identity = `${viewer.displayName} · ${organization.name}`

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

      {/*
        Who is signed in, and where. Read from the store rather than written
        into the chrome because the session decides both — one build serves
        every organization. Collapsed, only the avatar remains, carrying the
        name and organization in its title.

        Sign-out is a real form posting to the server action, not an onClick:
        it has to work before hydration and with scripts off, and the action
        both revokes the session row and clears the cookie (see actions/auth).
      */}
      <div
        className={cn(
          'flex shrink-0 border-t border-border-accent',
          collapsed ? 'flex-col items-center gap-1 px-2 py-3' : 'items-center gap-2.5 px-3 py-3'
        )}
      >
        <span title={collapsed ? identity : undefined} className="flex shrink-0">
          <MemberAvatar
            name={viewer.displayName}
            colleague={viewer.colleague}
            className="size-8 text-[11px]"
          />
        </span>
        {collapsed ? (
          // The avatar is decorative; this is what a screen reader gets.
          <span className="sr-only">{identity}</span>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-foreground">{viewer.displayName}</p>
            <p className="truncate font-mono text-[10.5px] text-muted">{organization.name}</p>
          </div>
        )}
        <form action={logout}>
          <button
            type="submit"
            title={t.nav.signOut}
            aria-label={t.nav.signOut}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <LogOut size={15} />
          </button>
        </form>
      </div>
    </aside>
  )
}
