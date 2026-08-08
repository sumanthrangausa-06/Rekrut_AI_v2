import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { ThemeProvider } from '@/contexts/theme-context'
import App from './App'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')
createRoot(rootEl).render(
	<StrictMode>
		<HelmetProvider>
			<ThemeProvider>
				<App />
			</ThemeProvider>
		</HelmetProvider>
	</StrictMode>,
)
