/**
 * Public surface of the CRM store.
 *
 * Consumers import `useCRMStore` from here and stay unaware of whether the
 * store is a singleton or per-request — which is the whole reason this barrel
 * exists, since it used to be the former and is now the latter.
 */

export { CRMStoreProvider, useCRMStore } from './provider'
export { createCRMStore } from './store'
export type { CRMStore, CRMStoreApi } from './store'
