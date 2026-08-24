import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'danger' | 'success' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

// `md` is the page-level primary action (matches the header actions on every
// tab); `sm` sits with the filter bar and in-form controls at h-9.
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-11 px-4 text-[13.5px] gap-1.5 sm:h-9',
  md: 'h-11 px-[18px] text-[14px] gap-1.5 sm:h-[38px]',
}

// 'primary' / 'danger' / 'success' get the gradient-grain treatment (.btn-grain
// in globals.css); 'secondary' / 'ghost' stay flat for lower-emphasis actions.
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'btn-grain btn-grain-primary',
  danger: 'btn-grain btn-grain-danger',
  success: 'btn-grain btn-grain-success',
  secondary: 'bg-surface-raised text-foreground border border-border-subtle hover:bg-surface',
  ghost: 'text-foreground hover:bg-surface-raised',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex touch-manipulation items-center justify-center rounded-lg font-semibold tracking-[0.01em] transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-45',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
})
