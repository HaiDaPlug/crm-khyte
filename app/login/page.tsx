import type { Metadata } from 'next'

import { LoginCard } from '@/components/auth/LoginForm'

export const metadata: Metadata = {
  title: 'Logga in — Khyte CRM',
  // The gate is not something to index even if this app is ever reachable
  // publicly; the CRM behind it certainly is not.
  robots: { index: false, follow: false },
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <LoginCard />
    </main>
  )
}
