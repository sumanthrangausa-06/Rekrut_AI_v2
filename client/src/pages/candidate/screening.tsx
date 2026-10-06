/**
 * Legacy chat screening page — REDIRECT STUB (Phase 1, #322).
 *
 * The old screening flow is superseded by the unified candidate interview
 * session page. This stub keeps the exported component name stable for any
 * remaining imports.
 */
import { Navigate } from 'react-router-dom';

export function CandidateScreeningPage() {
	return <Navigate to="/candidate" replace />;
}
