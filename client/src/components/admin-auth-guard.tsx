import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

interface AdminAuthGuardProps {
	children: ReactNode;
	/**
	 * Main-app roles allowed in addition to admin-panel access.
	 * Defaults to ['admin'] (existing behavior). S-065 (#715) passes
	 * ['admin', 'hiring_manager'] for the biometric audit viewer —
	 * server-side enforcement is at GET /api/admin/biometric-audit.
	 */
	allowedRoles?: string[];
}

export function AdminAuthGuard({ children, allowedRoles = ['admin'] }: AdminAuthGuardProps) {
	const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
	const location = useLocation();

	useEffect(() => {
		let cancelled = false;

		async function checkAdmin() {
			try {
				// Step 1: Check if already admin-authenticated (session cookie)
				const meRes = await fetch('/api/admin/me', {
					credentials: 'include',
					headers: getAuthHeaders(),
				});

				if (cancelled) return;

				if (meRes.ok) {
					const data = await meRes.json();
					if (data.authenticated) {
						setStatus('authenticated');
						return;
					}
				}

				// Step 2: Try to bridge — if user is logged into main app with admin role
				const token = getStoredToken();
				if (token) {
					// S-065: for non-admin allowed roles (e.g. hiring_manager),
					// check the main-app JWT role directly. This is UI gating only;
					// the API enforces authorization server-side.
					const jwtRole = getJwtRole(token);
					if (jwtRole && allowedRoles.includes(jwtRole)) {
						if (!cancelled) setStatus('authenticated');
						return;
					}

					const bridgeRes = await fetch('/api/admin/bridge', {
						method: 'POST',
						credentials: 'include',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${token}`,
						},
					});

					if (cancelled) return;

					if (bridgeRes.ok) {
						const bridgeData = await bridgeRes.json();
						if (bridgeData.success) {
							setStatus('authenticated');
							return;
						}
					}
				}

				// Step 3: Not authenticated — redirect to admin login
				if (!cancelled) setStatus('unauthenticated');
			} catch {
				if (!cancelled) setStatus('unauthenticated');
			}
		}

		checkAdmin();
		return () => {
			cancelled = true;
		};
	}, []);

	if (status === 'loading') {
		return (
			<div className="min-h-dvh-safe bg-slate-900 flex items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
					<p className="text-sm text-slate-400">Verifying admin access...</p>
				</div>
			</div>
		);
	}

	if (status === 'unauthenticated') {
		const returnTo = encodeURIComponent(location.pathname + location.search);
		return <Navigate to={`/admin/login?returnTo=${returnTo}`} replace />;
	}

	return <>{children}</>;
}

// Helper: get stored JWT token from localStorage
function getStoredToken(): string | null {
	try {
		return localStorage.getItem('rekrutai_token') || localStorage.getItem('hireloop_token') || null;
	} catch {
		return null;
	}
}

// Helper: build auth headers with stored token
function getAuthHeaders(): Record<string, string> {
	const token = getStoredToken();
	if (token) {
		return { Authorization: `Bearer ${token}` };
	}
	return {};
}

// Helper: decode the role claim from a JWT without verifying the signature.
// UI gating only — the API enforces authorization server-side.
function getJwtRole(token: string): string | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		const decoded = JSON.parse(atob(payload));
		return typeof decoded.role === 'string' ? decoded.role : null;
	} catch {
		return null;
	}
}
