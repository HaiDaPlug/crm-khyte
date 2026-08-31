import { headers } from 'next/headers'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Barlow, Plus_Jakarta_Sans } from 'next/font/google'
import { Instrument_Serif, Source_Serif_4 } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/layout/AppShell'
import { loadSnapshot, loadSnapshotVersion } from '@/lib/db/queries'
import { isAuthenticated } from '@/lib/auth/guard'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  subsets: ['latin'],
  weight: '400',
})

const barlow = Barlow({
  variable: '--font-barlow',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
})

const sourceSerif = Source_Serif_4({
  variable: '--font-source-serif',
  subsets: ['latin'],
})

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Khyte CRM',
  description: 'Ett lugnt, skarpt och förstklassigt CRM för operatörer',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#120f0c' },
    { media: '(prefers-color-scheme: light)', color: '#f3efe9' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The gate decides whether the CRM chrome renders at all. Reading the
  // session here rather than branching on the pathname is what lets a single
  // root layout serve both: layouts cannot see the pathname on the server
  // (they do not re-render on navigation), but they can read cookies.
  //
  // The snapshot load sits behind the same check on purpose — an
  // unauthenticated request must not reach the database, and AppShell would
  // otherwise hand a full copy of the working set to the client tree on the
  // login page.
  const authed = await isAuthenticated()

  // The wallpaper renders bare — no sidebar, no store, no CRM snapshot.
  //
  // Two reasons, and both matter. It is a desktop background, so chrome would
  // be absurd on it; and it reloads itself every few minutes, so pulling the
  // entire CRM working set through Postgres here would turn a read of three
  // small tables into a read of everything, forever. The display page calls
  // loadGoals() for exactly what it needs.
  //
  // Detected from the pathname header rather than a route group, because a
  // group would need its own root layout duplicating the font setup and
  // <html> element below — this is one branch instead of a second copy that
  // silently drifts.
  const headerList = await headers()
  const isDisplay = (headerList.get('x-pathname') ?? '').startsWith('/goals/display')

  // One read per full page load, handed to the client store below. Layouts do
  // not re-run on client-side navigation, so moving between routes costs
  // nothing — the store carries the data.
  //
  // The change-stamp is read first and sequentially, not in parallel with the
  // rows. It is the baseline SnapshotSync polls against, and a write landing
  // between the two reads must leave the stamp behind the data rather than
  // ahead of it: behind costs one redundant merge, ahead silently swallows the
  // change. One small aggregate is worth that ordering.
  const version = authed && !isDisplay ? await loadSnapshotVersion() : null
  const snapshot = authed && !isDisplay ? await loadSnapshot() : null

  return (
    <html
      lang="sv"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${barlow.variable} ${sourceSerif.variable} ${jakarta.variable} h-full`}
    >
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,600,700&display=swap"
        />
      </head>
      <body className="h-full antialiased">
        {snapshot ? (
          <AppShell snapshot={snapshot} version={version ?? 'demo'}>
            {children}
          </AppShell>
        ) : (
          children
        )}
      </body>
    </html>
  )
}
