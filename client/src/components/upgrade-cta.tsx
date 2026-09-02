import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { type FeatureKey, useSubscription } from '@/hooks/use-subscription';

interface UpgradeCTAProps {
	feature: FeatureKey;
	children: ReactNode;
	fallback?: ReactNode;
}

export function UpgradeCTA({ feature, children, fallback }: UpgradeCTAProps) {
	const { canUseFeature, isPro } = useSubscription();
	const navigate = useNavigate();
	const allowed = canUseFeature(feature);

	if (allowed) {
		return <>{children}</>;
	}

	if (fallback) {
		return <>{fallback}</>;
	}

	return (
		<div className="rounded-xl border border-dashed border-yellow-400 bg-yellow-50 p-6 text-center dark:border-yellow-600 dark:bg-yellow-950/30">
			<h3 className="mb-2 text-lg font-semibold text-yellow-800 dark:text-yellow-200">
				Pro Feature
			</h3>
			<p className="mb-4 text-sm text-yellow-700 dark:text-yellow-300">
				This feature is available exclusively on the Pro plan. Upgrade to unlock it and more.
			</p>
			<button
				onClick={() => navigate('/pricing')}
				className="inline-flex items-center rounded-lg bg-yellow-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-yellow-600 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
			>
				Upgrade to Pro
			</button>
		</div>
	);
}
