import * as React from 'react'
import { cn } from '@/lib/utils'

interface TabsContextType {
  value: string
  onChange: (value: string) => void
}

const TabsContext = React.createContext<TabsContextType>({ value: '', onChange: () => {} })

export function Tabs({ value, onValueChange, children, className }: {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <TabsContext.Provider value={{ value, onChange: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'inline-flex h-10 items-center rounded-lg bg-muted p-1 text-muted-foreground overflow-x-auto max-w-full scrollbar-hide',
      className
    )}>
      {children}
    </div>
  )
}

export function TabsTrigger({ value, children, className }: {
  value: string
  children: React.ReactNode
  className?: string
}) {
  const ctx = React.useContext(TabsContext)
  return (
    <button
      onClick={() => ctx.onChange(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none min-h-[36px]',
        ctx.value === value
          ? 'bg-background text-foreground shadow'
          : 'hover:bg-background/50',
        className
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({ value, children, className }: {
  value: string
  children: React.ReactNode
  className?: string
}) {
  const ctx = React.useContext(TabsContext)
  if (ctx.value !== value) return null
  return <div className={cn('mt-2', className)}>{children}</div>
}
