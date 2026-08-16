// DiceBear avatar utility — generates consistent avatar URLs from user IDs or names
// Used as fallback when no uploaded avatar is available

const DICEBEAR_BASE = 'https://api.dicebear.com/7.x/avataaars/svg'

/**
 * Generate a DiceBear avatar URL from a seed string (user ID, email, or name).
 * Returns a consistent SVG avatar for the same seed.
 */
export function getDiceBearAvatar(
	seed: string,
	options?: {
		backgroundColor?: string
		radius?: number
	},
): string {
	if (!seed) seed = 'anonymous'

	const params = new URLSearchParams({
		seed: seed.toLowerCase().trim(),
		backgroundColor: options?.backgroundColor || 'b6e3f4',
	})

	if (options?.radius) {
		params.set('radius', String(options.radius))
	}

	return `${DICEBEAR_BASE}?${params.toString()}`
}

/**
 * Get a DiceBear avatar for a user object. Uses user.id, then email, then name as seed.
 */
export function getUserAvatar(user: {
	id?: string | number
	email?: string
	name?: string
	avatar_url?: string | null
}): string {
	// If user has an uploaded avatar, use it
	if (user?.avatar_url) return user.avatar_url

	// Otherwise generate DiceBear avatar
	const seed = String(user?.id || user?.email || user?.name || 'anonymous')
	return getDiceBearAvatar(seed)
}

/**
 * Get a DiceBear avatar URL for a company/recruiter.
 */
export function getCompanyAvatar(companyName: string): string {
	return getDiceBearAvatar(companyName, { backgroundColor: 'c0aede' })
}

/**
 * Unsplash image URLs for marketing/hero sections.
 * Using specific photo IDs for consistency.
 */
export const UNSPLASH_IMAGES = {
	// Hero — diverse team collaborating
	hero: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&h=800&fit=crop',

	// Features — person working on laptop
	features: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=600&fit=crop',

	// Testimonials — diverse professionals
	testimonial1:
		'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face',
	testimonial2:
		'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
	testimonial3:
		'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=200&h=200&fit=crop&crop=face',
	testimonial4:
		'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face',

	// How it works
	step1: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&h=300&fit=crop',
	step2: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=300&fit=crop',
	step3: 'https://images.unsplash.com/photo-1521737711867-e3b97375c902?w=400&h=300&fit=crop',

	// Security/trust
	security: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=600&h=400&fit=crop',

	// Empty state illustrations
	emptyJobs: 'https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=400&h=300&fit=crop',
	emptyCandidates: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=400&h=300&fit=crop',
	emptyInterviews: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=400&h=300&fit=crop',
	emptyAssessments: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&h=300&fit=crop',
	emptyNotifications: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=300&fit=crop',
} as const
