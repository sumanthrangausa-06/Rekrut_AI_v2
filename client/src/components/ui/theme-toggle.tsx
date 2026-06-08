import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type Theme = 'light' | 'dark' | 'system'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light'
    return (localStorage.getItem('rekrut-theme') as Theme) || 'light'
  })

  const [resolved, setResolved] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    const t = localStorage.getItem('rekrut-theme') as Theme
    if (t === 'dark') return 'dark'
    return 'light'
  })

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')

    const resolvedTheme = theme === 'dark' ? 'dark' : 'light'
    root.classList.add(resolvedTheme)
    setResolved(resolvedTheme)
    localStorage.setItem('rekrut-theme', theme)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => {
      // ThemeProvider handles system preference; this component is manual toggle only
    }
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  return { theme, setTheme, resolved }
}

export function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme()

  const cycle = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  const icon = resolved === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10 min-h-[44px] min-w-[44px]"
      onClick={cycle}
      aria-label={`Theme: ${theme}. Click to cycle.`}
    >
      {icon}
    </Button>
  )
}
