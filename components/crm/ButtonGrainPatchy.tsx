import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'danger' | 'success' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-[12px] gap-1.5',
  md: 'h-9 px-4 text-[13px] gap-1.5',
}

// Snapshot of Button.tsx from before the "more orange, less patchy" pass —
// wired to .btn-grain-patchy in globals.css, which blends a coarse
// turbulence layer under the fine grain for mottled, cloud-like density.
// Kept in case that texture is wanted (e.g. on a larger surface where it
// doesn't just read as blotches). Not used by any page.
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'btn-grain-patchy btn-grain-patchy-primary',
  danger: 'btn-grain-patchy btn-grain-patchy-danger',
  success: 'btn-grain-patchy btn-grain-patchy-success',
  secondary: 'bg-surface-raised text-foreground border border-border-subtle hover:bg-surface',
  ghost: 'text-foreground hover:bg-surface-raised',
}

export const ButtonGrainPatchy = forwardRef<HTMLButtonElement, ButtonProps>(function ButtonGrainPatchy(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
})
