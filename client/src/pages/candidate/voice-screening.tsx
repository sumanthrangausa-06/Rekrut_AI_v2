/**
 * Legacy voice-screening page — REDIRECT STUB (Phase 1, #322).
 *
 * The old /screening/:token route now forwards to the unified candidate
 * interview session page. This stub keeps the exported component name stable
 * for any remaining imports.
 */
import { Navigate, useParams } from 'react-router-dom';

export function VoiceScreeningPage() {
	const { token } = useParams<{ token: string }>();
	return <Navigate to={`/interview/session/${token ?? ''}`} replace />;
}
