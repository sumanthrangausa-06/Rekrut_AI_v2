import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

interface ThemeContextType {
	theme: 'light' | 'dark'
	toggleTheme: () => void
	setTheme: (theme: 'light' | 'dark') => void
}

const ThemeContext = createContext<ThemeContextType>({
	theme: 'light',
	toggleTheme: () => {},
	setTheme: () => {},
})

const STORAGE_KEY = 'rekrut-theme'

function getInitialTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined') return 'light'
	try {
		const stored = localStorage.getItem(STORAGE_KEY)
		if (stored === 'dark' || stored === 'light') return stored
	} catch {
		// localStorage not available
	}
	// Fallback to system preference
	if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
		return 'dark'
	}
	return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<'light' | 'dark'>(getInitialTheme)
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		setMounted(true)
	}, [])

	useEffect(() => {
		const root = document.documentElement
		if (theme === 'dark') {
			root.classList.add('dark')
		} else {
			root.classList.remove('dark')
		}
		try {
			localStorage.setItem(STORAGE_KEY, theme)
		} catch {
			// localStorage not available
		}
	}, [theme])

	const toggleTheme = () => {
		setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'))
	}

	const setTheme = (newTheme: 'light' | 'dark') => {
		setThemeState(newTheme)
	}

	// Prevent flash of unstyled content by hiding body until mounted
	if (!mounted) {
		return <div style={{ visibility: 'hidden' }}>{children}</div>
	}

	return (
		<ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
			{children}
		</ThemeContext.Provider>
	)
}

export function useTheme() {
	const context = useContext(ThemeContext)
	if (!context) {
		throw new Error('useTheme must be used within a ThemeProvider')
	}
	return context
}
