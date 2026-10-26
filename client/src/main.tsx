import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/contexts/theme-context';
import App from './App';
import { tryChunkReload } from './lib/chunk-recovery';
import './index.css';

// #1868: a deploy renames the hashed chunks an open session still
// points at — recover with one guarded reload to the new shell.
window.addEventListener('vite:preloadError', (event) => {
	event.preventDefault();
	tryChunkReload();
});

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
	});
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(
	<StrictMode>
		<ThemeProvider>
			<App />
		</ThemeProvider>
	</StrictMode>,
);
