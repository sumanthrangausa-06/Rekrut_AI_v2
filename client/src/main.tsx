import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { ThemeProvider } from '@/contexts/theme-context'
import App from './App'
import './index.css'

// Initialize Sentry for error tracking — graceful if DSN is not set
if (import.meta.env.VITE_SENTRY_DSN || process.env.SENTRY_DSN) {
	Sentry.init({
		dsn: import.meta.env.VITE_SENTRY_DSN || process.env.SENTRY_DSN,
		integrations: [
			Sentry.browserTracingIntegration(),
			Sentry.replayIntegration({
				maskAllText: false,
				blockAllMedia: false,
			}),
		],
		// Performance Monitoring
		tracesSampleRate: 1.0,
		// Session Replay
		replaysSessionSampleRate: 0.1,
		replaysOnErrorSampleRate: 1.0,
	})
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')
createRoot(rootEl).render(
	<StrictMode>
		<ThemeProvider>
			<App />
		</ThemeProvider>
	</StrictMode>,
)
