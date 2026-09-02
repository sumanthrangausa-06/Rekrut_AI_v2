import { useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { apiCall } from '@/lib/api';

export type FeatureKey =
	| 'ai_job_matching'
	| 'mock_interviews'
	| 'assessments'
	| 'auto_apply'
	| 'cv_review'
	| 'linkedin_optimizer'
	| 'career_diagnosis'
	| 'recruiter_intros'
	| 'ai_coaching'
	| 'top_matches';

export interface FeatureUsage {
	allowed: boolean;
	limit: number | null;
	used: number;
	remaining: number | null;
}

export function useSubscription() {
	const { user, refreshSubscription } = useAuth();

	const tier = user?.subscriptionTier || 'free';
	const isPro = tier === 'pro';

	const canUseFeature = useCallback(
		(feature: FeatureKey): boolean => {
			if (isPro) {
				// Pro has access to everything; check rate-limited ones
				const rateLimited: FeatureKey[] = [
					'ai_job_matching',
					'mock_interviews',
					'auto_apply',
					'ai_coaching',
				];
				if (!rateLimited.includes(feature)) return true;
				// Pro rate limits are generous; treat as allowed (server enforces hard limits)
				return true;
			}

			// Free tier restrictions
			switch (feature) {
				case 'ai_job_matching':
				case 'mock_interviews':
				case 'assessments':
				case 'ai_coaching':
					return true;
				default:
					return false;
			}
		},
		[isPro],
	);

	const usageFor = useCallback(
		async (feature: FeatureKey): Promise<FeatureUsage> => {
			try {
				const data = await apiCall<{
					allowed: boolean;
					limit: number | null;
					used: number;
					remaining: number | null;
				}>(`/billing/usage?feature=${feature}`, { skipAuthCheck: false });
				return {
					allowed: data.allowed,
					limit: data.limit,
					used: data.used,
					remaining: data.remaining,
				};
			} catch {
				// Fallback: compute client-side based on tier
				const freeLimits: Record<FeatureKey, number | null> = {
					ai_job_matching: 20,
					mock_interviews: 3,
					assessments: null,
					auto_apply: 0,
					cv_review: 0,
					linkedin_optimizer: 0,
					career_diagnosis: 0,
					recruiter_intros: 0,
					ai_coaching: 5,
					top_matches: 0,
				};
				const limit = isPro ? null : freeLimits[feature];
				const allowed = canUseFeature(feature);
				return {
					allowed,
					limit,
					used: 0,
					remaining: limit !== null && limit !== undefined ? Math.max(0, limit) : null,
				};
			}
		},
		[isPro, canUseFeature],
	);

	return useMemo(
		() => ({
			tier,
			isPro,
			canUseFeature,
			usageFor,
			refreshSubscription,
		}),
		[tier, isPro, canUseFeature, usageFor, refreshSubscription],
	);
}
