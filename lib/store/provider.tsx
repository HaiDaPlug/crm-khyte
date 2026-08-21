'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { CRMSnapshot } from '@/lib/types'
import { createCRMStore, type CRMStore, type CRMStoreApi } from './store'

const CRMStoreContext = createContext<CRMStoreApi | null>(null)

/**
 * Owns the store for one page load.
 *
 * The store is created in a `useState` initializer, so it is built once per
 * mount and never rebuilt — and, crucially, it exists with the snapshot
 * already inside it before any consumer below renders. That is what lets the
 * server HTML and the client's hydration pass agree: both read
 * `getInitialState()`, which zustand fixes at construction.
 *
 * On the server this runs once per request, which replaces the module
 * singleton the store used to be. Two concurrent requests now get two stores
 * instead of taking turns overwriting one.
 *
 * Must sit above anything that calls `useCRMStore` — see AppShell.
 */
export function CRMStoreProvider({
  snapshot,
  children,
}: {
  snapshot: CRMSnapshot
  children: ReactNode
}) {
  const [store] = useState(() => createCRMStore(snapshot))

  return <CRMStoreContext.Provider value={store}>{children}</CRMStoreContext.Provider>
}

/**
 * Reads a slice of the CRM store.
 *
 * Same call shape as the bound hook it replaces —
 * `useCRMStore((s) => s.opportunities)` — so consumers did not have to change.
 * The difference is that it resolves the store from context rather than a
 * module-level singleton.
 */
export function useCRMStore<T>(selector: (state: CRMStore) => T): T {
  const store = useContext(CRMStoreContext)

  if (store === null) {
    throw new Error('useCRMStore must be used inside <CRMStoreProvider>.')
  }

  return useStore(store, selector)
}
