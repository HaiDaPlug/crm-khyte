import type { Metadata } from 'next'

import { LoginCard } from '@/components/auth/LoginForm'
import { loginReturnTo } from '@/lib/auth/return-to'

export const metadata: Metadata = {
  title: 'Logga in — Khyte CRM',
  // The gate is not something to index even if this app is ever reachable
  // publicly; the CRM behind it certainly is not.
  robots: { index: false, follow: false },
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <LoginCard returnTo={loginReturnTo(returnTo)} />
    </main>
  )
}
