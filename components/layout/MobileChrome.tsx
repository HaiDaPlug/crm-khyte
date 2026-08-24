'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Grid2X2, Moon, Sun, X } from 'lucide-react'
import { useCRMStore } from '@/lib/store'
import { useTranslations } from '@/lib/hooks/useTranslations'
import { useDialogBehavior, useMounted } from '@/lib/hooks/useDialog'
import { cn } from '@/lib/utils'
import khyteLogo from '@/public/khyte-logo-text-png.png'
import { navItems } from './AppSidebar'

const primaryHrefs = ['/dashboard', '/leads', '/pipeline', '/tasks'] as const

interface MobileChromeProps {
  menuOpen: boolean
  onMenuOpen: () => void
  onMenuClose: () => void
}

export function MobileChrome({ menuOpen, onMenuOpen, onMenuClose }: MobileChromeProps) {
  const { t } = useTranslations()
  const pathname = usePathname()
  const theme = useCRMStore((s) => s.settings.theme)
  const toggleTheme = useCRMStore((s) => s.toggleTheme)
  const panelRef = useRef<HTMLDivElement>(null)
  const mounted = useMounted()

  useDialogBehavior({ open: menuOpen, onClose: onMenuClose, panelRef })

  useEffect(() => {
    if (menuOpen) panelRef.current?.focus()
  }, [menuOpen])

  const currentItem =
    navItems.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`)) ?? navItems[0]
  const primaryItems = navItems.filter(({ href }) =>
    primaryHrefs.includes(href as (typeof primaryHrefs)[number])
  )
  const moreActive = !primaryItems.some(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`)
  )

  const drawer = mounted
    ? createPortal(
        <div className="lg:hidden">
          <div
            className={cn(
              'fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300',
              menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            onMouseDown={onMenuClose}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            id="mobile-navigation-sheet"
            data-theme="dark"
            role="dialog"
            aria-modal="true"
            aria-label={t.nav.menu}
            aria-hidden={!menuOpen}
            tabIndex={-1}
            inert={!menuOpen}
            className={cn(
              'grain-nav fixed inset-y-0 left-0 z-50 flex w-[min(86vw,336px)] flex-col outline-none',
              'pl-[env(safe-area-inset-left)]',
              'border-r border-border-accent shadow-[24px_0_64px_-24px_rgba(0,0,0,0.8)]',
              'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
              menuOpen ? 'translate-x-0' : '-translate-x-full'
            )}
          >
            <div className="flex min-h-[calc(60px+env(safe-area-inset-top))] items-end justify-between border-b border-border-accent px-4 pb-3 pt-[env(safe-area-inset-top)]">
              <Image src={khyteLogo} alt="Khyte" width={84} height={36} className="h-9 w-[84px]" />
              <button
                type="button"
                onClick={onMenuClose}
                aria-label={t.nav.closeMenu}
                className="flex size-11 items-center justify-center rounded-xl text-foreground/70 transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <X size={19} />
              </button>
            </div>

            <nav aria-label={t.nav.primaryNavigation} className="flex-1 overflow-y-auto px-3 py-4">
              <div className="space-y-1">
                {navItems.map(({ href, label, icon: Icon }) => {
                  const isActive = pathname === href || pathname.startsWith(`${href}/`)
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onMenuClose}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex min-h-12 items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium transition-colors',
                        isActive
                          ? 'bg-accent-light text-foreground'
                          : 'text-foreground/75 hover:bg-surface-raised hover:text-foreground'
                      )}
                    >
                      {isActive && (
                        <span className="absolute inset-y-3 left-0 w-0.5 rounded-r-full bg-accent" />
                      )}
                      <Icon
                        size={19}
                        strokeWidth={isActive ? 2 : 1.6}
                        className={isActive ? 'text-accent' : 'text-muted'}
                      />
                      {t.nav[label]}
                    </Link>
                  )
                })}
              </div>
            </nav>

            <div className="border-t border-border-accent px-3 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3.5 text-[14px] text-foreground/75 transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                {theme === 'dark' ? t.nav.lightMode : t.nav.darkMode}
              </button>
              <div className="mt-2 flex items-center gap-2.5 px-3.5 py-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-background">
                  K
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-foreground">{t.nav.workspace}</p>
                  <p className="truncate font-mono text-[10.5px] text-muted">khyte.io</p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <>
      <header
        data-theme="dark"
        className="grain-nav fixed inset-x-0 top-0 z-30 flex h-[var(--mobile-topbar-height)] items-end border-b border-border-accent pb-2.5 pt-[env(safe-area-inset-top)] [padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))] lg:hidden"
      >
        <div className="flex h-10 w-full items-center gap-3">
          <div className="h-9 w-8 overflow-hidden">
            <Image
              src={khyteLogo}
              alt="Khyte"
              width={84}
              height={36}
              className="h-9 w-[84px] max-w-none"
            />
          </div>
          <span className="h-5 w-px bg-border-accent" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
            {t.nav[currentItem.label]}
          </p>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.nav.switchToLight : t.nav.switchToDark}
            className="flex size-11 items-center justify-center rounded-xl text-foreground/70 transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <nav
        data-theme="dark"
        aria-label={t.nav.primaryNavigation}
        className="grain-nav fixed inset-x-0 bottom-0 z-30 flex h-[var(--mobile-bottomnav-height)] items-start border-t border-border-accent pb-[env(safe-area-inset-bottom)] pt-1.5 [padding-left:max(0.25rem,env(safe-area-inset-left))] [padding-right:max(0.25rem,env(safe-area-inset-right))] lg:hidden"
      >
        {primaryItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10.5px] font-medium transition-colors',
                isActive ? 'text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              {isActive && <span className="absolute -top-1.5 h-0.5 w-7 rounded-full bg-accent" />}
              <Icon size={20} strokeWidth={isActive ? 2.1 : 1.55} className={isActive ? 'text-accent' : ''} />
              <span className="max-w-full truncate px-0.5">{t.nav[label]}</span>
            </Link>
          )
        })}
        <button
          type="button"
          onClick={onMenuOpen}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation-sheet"
          className={cn(
            'relative flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10.5px] font-medium transition-colors',
            moreActive || menuOpen ? 'text-foreground' : 'text-muted hover:text-foreground'
          )}
        >
          {(moreActive || menuOpen) && <span className="absolute -top-1.5 h-0.5 w-7 rounded-full bg-accent" />}
          <Grid2X2 size={20} strokeWidth={moreActive || menuOpen ? 2.1 : 1.55} className={moreActive || menuOpen ? 'text-accent' : ''} />
          <span>{t.nav.more}</span>
        </button>
      </nav>

      {drawer}
    </>
  )
}
