'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Monitor } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ColleagueId } from '@/lib/types'

/**
 * The links you paste into Lively Wallpaper — one per person.
 *
 * Each carries a signed display token so Lively's cookie-less Chromium embed
 * can render the board without a session (lib/auth/display-token.ts). That
 * makes the URL itself the credential, so it is shown as a copyable string
 * rather than a bare anchor: it should be handed to one person deliberately,
 * not left where a screen-share picks it up.
 *
 * The origin is read from the browser rather than baked in, so the same panel
 * yields a localhost link in dev and a crm.khyte.se link in production without
 * a build-time variable to keep in sync.
 */

export interface WallpaperLink {
  id: ColleagueId
  name: string
  color: string
  /** Undefined when DISPLAY_SECRET is unset — see the notice below. */
  token: string | undefined
}

export function WallpaperLinks({ links }: { links: WallpaperLink[] }) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // After mount: the server has no idea what host the browser used, and
  // rendering a guess would make the first paint disagree with the HTML.
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const urlFor = (link: WallpaperLink) =>
    link.token ? `${origin}/goals/display/${link.id}?k=${link.token}` : ''

  const unconfigured = links.some((link) => !link.token)

  return (
    <section className="mb-5 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Monitor size={15} className="text-accent" />
        <h3 className="label-mono">Bakgrundsbilder</h3>
      </div>

      {unconfigured ? (
        <p className="text-[14px] leading-relaxed text-foreground/60">
          <code className="rounded bg-background-raised px-1.5 py-0.5 font-mono text-[13px]">
            DISPLAY_SECRET
          </code>{' '}
          är inte satt, så inga länkar kan signeras. Lägg till den i{' '}
          <code className="rounded bg-background-raised px-1.5 py-0.5 font-mono text-[13px]">
            .env.local
          </code>{' '}
          — se <code className="font-mono text-[13px]">.env.example</code>.
        </p>
      ) : (
        <>
          <p className="mb-4 text-[13.5px] leading-relaxed text-foreground/55">
            Klistra in i Lively Wallpaper. Länken innehåller nyckeln — dela den
            bara med den det gäller. Tavlan uppdaterar sig själv var femte minut.
          </p>

          <ul className="flex flex-col gap-2">
            {links.map((link) => {
              const url = urlFor(link)
              return (
                <li
                  key={link.id}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-background-raised px-3 py-2.5"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: link.color }}
                  />
                  <span className="w-16 shrink-0 text-[14px] font-medium text-foreground">
                    {link.name}
                  </span>

                  <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground/50">
                    {/* Empty until the origin lands after mount. */}
                    {url || '…'}
                  </code>

                  <button
                    type="button"
                    disabled={!url}
                    onClick={() => {
                      void navigator.clipboard.writeText(url).then(() => {
                        setCopied(link.id)
                      })
                    }}
                    aria-label={`Kopiera länk för ${link.name}`}
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      'text-foreground/50 transition-colors hover:bg-surface-raised hover:text-foreground',
                      'disabled:cursor-not-allowed disabled:opacity-40'
                    )}
                  >
                    {copied === link.id ? (
                      <Check size={15} className="text-success" />
                    ) : (
                      <Copy size={15} />
                    )}
                  </button>

                  <a
                    href={url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Öppna ${link.name}s tavla`}
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      'text-foreground/50 transition-colors hover:bg-surface-raised hover:text-foreground'
                    )}
                  >
                    <ExternalLink size={15} />
                  </a>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
