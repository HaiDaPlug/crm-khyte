'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Lock } from 'lucide-react'

import { login, type LoginState } from '@/app/actions/auth'
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
  subtitle: 'Ange lösenord för att fortsätta',
  label: 'Lösenord',
  submit: 'Logga in',
  submitting: 'Loggar in...',
  errors: {
    empty: 'Ange ett lösenord.',
    invalid: 'Fel lösenord.',
    throttled: 'För många försök. Vänta en stund och försök igen.',
  },
} as const

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

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, undefined)

  const message = state?.error
    ? copy.errors[state.error as keyof typeof copy.errors]
    : null

  return (
    <form action={action} className="flex w-full flex-col gap-5">
      <div>
        <label htmlFor="password" className="label-mono mb-2 block">
          {copy.label}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          // The only field on the page, and the page exists to be typed into.
          autoFocus
          required
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? 'password-error' : undefined}
          className={cn(inputClass, message && 'border-danger/60')}
        />
      </div>

      {/* Reserves no space when empty — the form is short enough that a shift
          on error reads as feedback rather than as a layout jump. */}
      {message && (
        <p
          id="password-error"
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

export function LoginCard() {
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

      <LoginForm />
    </div>
  )
}
