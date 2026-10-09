/**
 * Shared Profile Completion calculation.
 *
 * Used by both the Candidate Profile page and the Dashboard (via backend).
 * Both surfaces MUST show the same percentage — do not duplicate this logic.
 *
 * 12 fields, each worth equal weight:
 *  1. name
 *  2. headline
 *  3. bio
 *  4. location
 *  5. linkedin_url OR github_url (social link)
 *  6. resume_url
 *  7. skills (at least 1)
 *  8. experience (at least 1 entry)
 *  9. education (at least 1 entry)
 * 10. phone
 * 11. years_experience (not null)
 * 12. avatar_url
 */

export interface ProfileCompletionInput {
	name?: string | null;
	headline?: string | null;
	bio?: string | null;
	location?: string | null;
	linkedin_url?: string | null;
	github_url?: string | null;
	resume_url?: string | null;
	phone?: string | null;
	years_experience?: number | null;
	avatar_url?: string | null;
	hasSkills: boolean;
	hasExperience: boolean;
	hasEducation: boolean;
}

export function calculateProfileCompletion(input: ProfileCompletionInput): number {
	const fields = [
		input.name,
		input.headline,
		input.bio,
		input.location,
		input.linkedin_url || input.github_url,
		input.resume_url,
		input.hasSkills,
		input.hasExperience,
		input.hasEducation,
		input.phone,
		input.years_experience != null,
		input.avatar_url,
	];
	return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

/**
 * Returns the list of missing section labels for the "complete your profile" nudge.
 * Keep in sync with calculateProfileCompletion field order.
 */
export function getMissingProfileSections(input: ProfileCompletionInput): string[] {
	return [
		!input.name && 'Name',
		!input.headline && 'Headline',
		!input.bio && 'Bio',
		!input.location && 'Location',
		!(input.linkedin_url || input.github_url) && 'Social Links',
		!input.resume_url && 'Resume',
		!input.hasSkills && 'Skills',
		!input.hasExperience && 'Experience',
		!input.hasEducation && 'Education',
		!input.phone && 'Phone',
		input.years_experience == null && 'Years of Experience',
		!input.avatar_url && 'Profile Photo',
	].filter(Boolean) as string[];
}
