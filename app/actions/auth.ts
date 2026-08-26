'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSession,
  sessionCookieOptions,
  verifyPassword,
} from '@/lib/auth/session'

/**
 * The gate's two actions.
 *
 * Kept apart from actions/crm.ts on purpose: those are narrow writes called by
 * the client store after an optimistic update, these are form handlers that
 * set cookies and redirect. Different shape, different lifecycle.
 */

export type LoginState = { error: string } | undefined

/**
 * Slows down guessing, per server process.
 *
 * A shared password has no account to lock, so the only thing to throttle is
 * the origin. This is deliberately modest — an in-memory map resets on deploy
 * and is per-instance, so it frustrates a script pointed at one box rather
 * than a distributed effort. It is the last line before the password itself,
 * not a substitute for choosing a long one. Move to a shared store if this
 * ever runs on more than one instance.
 */
const attempts = new Map<string, { count: number; firstAt: number }>()

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

function tooManyAttempts(key: string): boolean {
  const now = Date.now()
  const record = attempts.get(key)

  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now })
    return false
  }

  record.count += 1
  return record.count > MAX_ATTEMPTS
}

function clearAttempts(key: string) {
  attempts.delete(key)
}

export async function login(
  _state: LoginState,
  formData: FormData
): Promise<LoginState> {
  const password = formData.get('password')

  if (typeof password !== 'string' || password.length === 0) {
    return { error: 'empty' }
  }

  // Per-process, not per-IP: behind a proxy every request can arrive with the
  // same forwarded address, and trusting a client-settable header for the key
  // would let an attacker rotate it freely. One shared bucket is the honest
  // version of what this can actually enforce.
  const key = 'global'

  if (tooManyAttempts(key)) {
    return { error: 'throttled' }
  }

  if (!verifyPassword(password)) {
    return { error: 'invalid' }
  }

  clearAttempts(key)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, createSession(), {
    ...sessionCookieOptions,
    maxAge: SESSION_MAX_AGE,
  })

  // Outside the try/catch-free path above on purpose: redirect() signals by
  // throwing, so it has to be the last thing the action does.
  redirect('/')
}

export async function logout() {
  const cookieStore = await cookies()
  cookieStore.delete({ name: SESSION_COOKIE, ...sessionCookieOptions })
  redirect('/login')
}
