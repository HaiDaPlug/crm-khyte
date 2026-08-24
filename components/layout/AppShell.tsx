'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CRMStoreProvider, useCRMStore } from '@/lib/store'
import type { CRMSnapshot } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AppSidebar } from './AppSidebar'
import { MobileChrome } from './MobileChrome'
import { useTranslations } from '@/lib/hooks/useTranslations'

/**
 * Root of the client tree.
 *
 * Nothing here reads the store directly — the chrome below does, and it has to
 * sit inside the provider to do so.
 */
export function AppShell({
  snapshot,
  children,
}: {
  snapshot: CRMSnapshot
  children: React.ReactNode
}) {
  return (
    <CRMStoreProvider snapshot={snapshot}>
      <AppShellChrome>{children}</AppShellChrome>
    </CRMStoreProvider>
  )
}

function AppShellChrome({ children }: { children: React.ReactNode }) {
  const { t } = useTranslations()
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const collapsed = useCRMStore((s) => s.sidebarCollapsed)
  const theme = useCRMStore((s) => s.settings.theme)
  const language = useCRMStore((s) => s.settings.language)
  const hydrateSettings = useCRMStore((s) => s.hydrateSettings)

  // Deferred to an effect on purpose: the saved preferences live in
  // localStorage, which the server can't see. Applying them during render
  // would make the first client paint disagree with the server HTML on every
  // formatted amount and date.
  useEffect(() => {
    hydrateSettings()
  }, [hydrateSettings])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    document.title = 'Khyte CRM'
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute('content', t.metadata.description)
  }, [t.metadata.description])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)')
    const closeMenuAtDesktop = () => {
      if (desktopQuery.matches) setMobileMenuOpen(false)
    }

    closeMenuAtDesktop()
    desktopQuery.addEventListener('change', closeMenuAtDesktop)
    return () => desktopQuery.removeEventListener('change', closeMenuAtDesktop)
  }, [])

  return (
    <div className="flex min-h-full">
      <AppSidebar />
      <MobileChrome
        menuOpen={mobileMenuOpen}
        onMenuOpen={() => setMobileMenuOpen(true)}
        onMenuClose={() => setMobileMenuOpen(false)}
      />
      <div
        className={cn(
          'flex min-h-dvh min-w-0 w-full flex-1 flex-col',
          'pt-[var(--mobile-topbar-height)] pb-[var(--mobile-bottomnav-height)]',
          'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:pl-0 lg:pr-0',
          'transition-[margin] duration-300 ease-out lg:pt-0 lg:pb-0',
          collapsed ? 'lg:ml-16' : 'lg:ml-[232px]'
        )}
      >
        {children}
      </div>
    </div>
  )
}
