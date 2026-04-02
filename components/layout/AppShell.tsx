'use client'

import { useCRMStore } from '@/lib/store'
import { AppSidebar } from './AppSidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useCRMStore((s) => s.sidebarCollapsed)

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
