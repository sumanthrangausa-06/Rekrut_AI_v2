import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { scrubSentryEvent } from './lib/sentryScrub';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/contexts/theme-context';
import App from './App';
import './index.css';

// Initialize Sentry for error tracking — graceful if DSN is not set
if (import.meta.env.VITE_SENTRY_DSN || process.env.SENTRY_DSN) {
	Sentry.init({
		dsn: import.meta.env.VITE_SENTRY_DSN || process.env.SENTRY_DSN,
		// #1180: pre-enablement hardening — same scrub contract as the server
		// (client/src/lib/sentryScrub.ts mirrors lib/sentry-scrub.js).
		beforeSend: (event) => scrubSentryEvent(event),
		beforeSendTransaction: (event) => scrubSentryEvent(event),
		integrations: [
			Sentry.browserTracingIntegration(),
			Sentry.replayIntegration({
				// #1180: replay text/inputs/media are masked. NOTE: replay
				// payloads do NOT pass through beforeSend — element attributes
				// (title/alt/aria-label/data-*/href) and page URLs in replays
				// are a residual exposure, recorded on #1180 as a binding
				// pre-enablement (item 3) decision. DSN stays unset until then.
				maskAllText: true,
				blockAllMedia: true,
				maskAllInputs: true,
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
