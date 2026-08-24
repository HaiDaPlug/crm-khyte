import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Barlow, Plus_Jakarta_Sans } from 'next/font/google'
import { Instrument_Serif, Source_Serif_4 } from 'next/font/google'
import './globals.css'
import { AppShell } from '@/components/layout/AppShell'
import { loadSnapshot } from '@/lib/db/queries'

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
  // One read per full page load, handed to the client store below. Layouts do
  // not re-run on client-side navigation, so moving between routes costs
  // nothing — the store carries the data.
  const snapshot = await loadSnapshot()

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
        <AppShell snapshot={snapshot}>{children}</AppShell>
      </body>
    </html>
  )
}
