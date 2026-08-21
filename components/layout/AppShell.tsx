'use client'

import { useEffect } from 'react'
import { CRMStoreProvider, useCRMStore } from '@/lib/store'
import type { CRMSnapshot } from '@/lib/types'
import { AppSidebar } from './AppSidebar'
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

  return (
    <div className="flex h-full">
      <AppSidebar />
      <div
        className="flex-1 min-w-0 flex flex-col transition-[margin] duration-300 ease-out"
        style={{ marginLeft: collapsed ? 64 : 232 }}
      >
        {children}
      </div>
    </div>
  )
}
