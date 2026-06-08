import * as React from 'react'
import { cn } from '@/lib/utils'

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  label?: React.ReactNode
  id?: string
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, label, id, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(e.target.checked)
      props.onChange?.(e)
    }
    const uniqueId = id || React.useId()

    return (
      <label
        htmlFor={uniqueId}
        className={cn(
          'flex items-center gap-2 cursor-pointer select-none',
          className
        )}
      >
        <div className="relative flex items-center">
          <input
            ref={ref}
            id={uniqueId}
            type="checkbox"
            checked={checked}
            onChange={handleChange}
            className="peer sr-only"
            {...props}
          />
          <div
            className={cn(
              'h-4 w-4 rounded border transition-colors flex items-center justify-center',
              checked
                ? 'bg-primary border-primary'
                : 'border-input bg-background hover:border-primary/50'
            )}
          >
            {checked && (
              <svg className="h-3 w-3 text-primary-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>
        {label && <span className="text-sm">{label}</span>}
      </label>
    )
  }
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
