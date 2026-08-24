/**
 * Tiny synthesised UI sounds.
 *
 * Synthesised rather than shipped as an audio file: a `.mp3` would be a binary
 * in the repo, a network fetch on first play, and a decode step before it could
 * sound. Two oscillators cost nothing and are instant, offline, and tweakable
 * in-place.
 */

let context: AudioContext | null = null

/**
 * The AudioContext is created on first use — never at import time. Browsers
 * start one in a `suspended` state unless it is constructed during a user
 * gesture, so this is only ever called from a click handler.
 */
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null

  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    context = new Ctor()
  }

  // Chrome suspends the context when a tab is backgrounded; resume is a no-op
  // when it is already running.
  if (context.state === 'suspended') void context.resume()
  return context
}

/** One struck-bell partial: a sine that blooms and decays on its own curve. */
function partial(
  ctx: AudioContext,
  frequency: number,
  gain: number,
  startAt: number,
  decay: number
): void {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequency, startAt)

  // A 6ms attack rather than an instant one — a hard start reads as a click,
  // and exponentialRamp cannot begin from zero.
  amp.gain.setValueAtTime(0.0001, startAt)
  amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.006)
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + decay)

  osc.connect(amp).connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + decay + 0.02)
}

/**
 * The check-off chime: C6 with its fifth above, the upper partial entering a
 * touch late and dying first, which is what makes a real bell sound bright at
 * the strike and warm as it rings out.
 *
 * Safe to call from any click handler — it never throws, and does nothing at
 * all where Web Audio is unavailable.
 */
export function playCheckChime(): void {
  try {
    const ctx = getContext()
    if (!ctx) return

    const now = ctx.currentTime
    partial(ctx, 1046.5, 0.16, now, 0.62) //  C6 — the body
    partial(ctx, 1568.0, 0.09, now + 0.035, 0.42) //  G6 — the shimmer
  } catch {
    // Audio is a garnish. A blocked or exhausted context must never take the
    // interaction down with it.
  }
}
