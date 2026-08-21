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
        'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
})
