'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Lock } from 'lucide-react'

import { login, type LoginError, type LoginState } from '@/app/actions/auth'
import { Button } from '@/components/crm/Button'
import { inputClass } from '@/components/crm/FormFields'
import { cn } from '@/lib/utils'

/**
 * Copy lives here rather than in lib/i18n/translations.ts.
 *
 * The dictionary is reached through useTranslations, which reads the client
 * store — and the store is populated from the server snapshot in AppShell,
 * which this page deliberately renders outside of. Swedish matches the
 * `lang="sv"` the root layout sets, so an unauthenticated visitor sees the
 * same language the app boots in.
 */
const copy = {
  title: 'Khyte CRM',
  subtitle: 'Logga in för att fortsätta',
  email: 'E-post',
  password: 'Lösenord',
  submit: 'Logga in',
  submitting: 'Loggar in...',
  // `satisfies` rather than a lookup that tolerates a miss: a LoginError the
  // action can return but this table cannot name would render as nothing at
  // all, which on a login form reads as the button doing nothing.
  errors: {
    empty: 'Ange e-post och lösenord.',
    invalid: 'Fel e-post eller lösenord.',
    throttled: 'För många försök. Vänta en stund och försök igen.',
    no_membership: 'Kontot tillhör ingen arbetsyta. Be en ägare lägga till dig.',
    not_configured: 'Inloggning är inte konfigurerad på den här servern.',
    unavailable: 'Inloggningstjänsten svarar inte. Försök igen om en stund.',
  } satisfies Record<LoginError, string>,
}

/** The errors that are about what was typed, as opposed to the server. */
const FIELD_ERRORS: ReadonlySet<LoginError> = new Set(['empty', 'invalid'])

function SubmitButton() {
  // useFormStatus has to read the status from a form above it, so this cannot
  // be inlined into the form component below.
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? copy.submitting : copy.submit}
    </Button>
  )
}

export function LoginForm({ returnTo = '/' }: { returnTo?: string }) {
  const [state, action] = useActionState<LoginState, FormData>(login, undefined)

  // Controlled on purpose: React resets a form's uncontrolled fields once its
  // action settles, which would wipe the address on every wrong password and
  // make the person retype it. The password field stays uncontrolled — a
  // rejected password should not linger in the box.
  const [email, setEmail] = useState('')

  const message = state?.error ? copy.errors[state.error] : null
  const fieldsRejected = state?.error ? FIELD_ERRORS.has(state.error) : false

  return (
    <form action={action} className="flex w-full flex-col gap-5">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div>
        <label htmlFor="email" className="label-mono mb-2 block">
          {copy.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          // `username` is what password managers key the saved pair on; an
          // `email` hint would fill the address but not offer the password.
          autoComplete="username"
          spellCheck={false}
          // The first field on the page, and the page exists to be typed into.
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldsRejected ? true : undefined}
          aria-describedby={message ? 'login-error' : undefined}
          className={cn(inputClass, fieldsRejected && 'border-danger/60')}
        />
      </div>

      <div>
        <label htmlFor="password" className="label-mono mb-2 block">
          {copy.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={fieldsRejected ? true : undefined}
          aria-describedby={message ? 'login-error' : undefined}
          className={cn(inputClass, fieldsRejected && 'border-danger/60')}
        />
      </div>

      {/* Reserves no space when empty — the form is short enough that a shift
          on error reads as feedback rather than as a layout jump. */}
      {message && (
        <p
          id="login-error"
          // Announced on change so a screen reader hears the rejection without
          // the focus having to move.
          role="alert"
          className="text-[13.5px] text-danger"
        >
          {message}
        </p>
      )}

      <SubmitButton />
    </form>
  )
}

export function LoginCard({ returnTo = '/' }: { returnTo?: string }) {
  return (
    <div className="w-full max-w-[380px]">
      <div className="mb-7 flex flex-col items-center text-center">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-border-subtle bg-surface-raised">
          <Lock className="h-[18px] w-[18px] text-accent" aria-hidden="true" />
        </div>
        <h1 className="font-jakarta text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          {copy.title}
        </h1>
        <p className="mt-1.5 text-[14px] text-foreground-dim">{copy.subtitle}</p>
      </div>

      <LoginForm returnTo={returnTo} />
    </div>
  )
}
